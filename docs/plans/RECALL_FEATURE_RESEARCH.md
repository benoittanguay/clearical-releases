# Recall — Digital Memory Feature Research

> **Status:** Exploratory research
> **Last updated:** 2026-02-09

## Overview

Recall (working name, also considered "Rewind") is a feature that turns Clearical's passively captured data into an actively queryable digital memory. Users would ask natural language questions about things they've seen, done, or discussed across their work sessions.

### Example queries

- "What was that charting library I was looking at on Tuesday?"
- "What did we decide about the deadline in the standup?"
- "When did I last touch the auth module?"
- "What was the website with the dark sidebar and the orange logo?"
- "What did I accomplish this week?"

---

## Existing data sources

Clearical already captures a rich dataset that Recall would index:

| Source | What it captures | Storage location |
|---|---|---|
| Window activity | App name, window title, browser profile, timestamps, duration | `entries.window_activity` (JSON) |
| Screenshot analysis | OCR text (Vision Framework) + AI description (Claude) | `WindowActivity.screenshotAnalysis` |
| Screenshot images | Raw PNG files on disk | `WindowActivity.screenshotPaths` |
| Meeting transcriptions | Full text, segments, timestamps, language | `entries.transcriptions` (JSON) |
| Time entry metadata | Start/end, description, detected technologies, detected activities | `entries` table |
| Calendar events | Titles, times, provider | `calendar_events` table |
| Jira issues (cached) | Keys, summaries, status, project | `jira_issues` table |

---

## Proposed architecture: Local RAG

### Tech stack

| Layer | Tool | Notes |
|---|---|---|
| Text embedding model | `bge-small-en-v1.5` (384d, ~33 MB) | Best modern quality/size for small models. Runs via Transformers.js |
| Embedding runtime | `@huggingface/transformers` v3 | Production-ready, ONNX under the hood, works in Electron |
| Vector storage | `sqlite-vec` extension for `better-sqlite3` | Keeps everything in one SQLite DB file. Brute-force search, fine for desktop scale (<100K vectors) |
| Full-text search | SQLite FTS5 (built into `better-sqlite3`) | Keyword matching, no extra deps |
| Retrieval strategy | Reciprocal Rank Fusion (FTS5 + vector) | Balances exact keyword matches with semantic similarity |
| Answer generation | Claude API (already integrated) | Takes top-K retrieved chunks + user question, generates answer |

### Why this stack

- **Single database file** — vectors, FTS indexes, and app data all in one SQLite DB
- **No server processes** — everything embedded in Electron main process
- **Minimal new deps** — `sqlite-vec` extension + `@huggingface/transformers`
- **Sufficient scale** — brute-force vector search on 384d handles tens of thousands of chunks fine

---

## Screenshot handling

Two complementary approaches for making screenshots searchable:

### Visual embedding via SigLIP

Embeds the raw screenshot image into a shared text-image vector space. Enables visual similarity queries.

**Model:** `Xenova/siglip-base-patch16-512` (q4 quantization)

| Spec | Value |
|---|---|
| Vision model size | ~63 MB (q4) |
| Text model size | ~155 MB (q4) |
| Embedding dimensions | 768 |
| Input resolution | 512x512 (highest available, best for screenshots) |
| Speed per screenshot | ~150-300ms on Apple Silicon |
| Transformers.js support | Yes, production-ready |

**Strengths:** Visual layout, colors, UI patterns, recognizing apps, chart types, scene understanding
**Weaknesses:** Cannot read specific text on screen. Trained on natural images, not UI/document screenshots.

```javascript
import { SiglipVisionModel, SiglipTextModel } from '@huggingface/transformers';

// Capture time (~200ms)
const visionModel = await SiglipVisionModel.from_pretrained(
  'Xenova/siglip-base-patch16-512', { dtype: 'q4' }
);
const imageEmbedding = await visionModel(preprocessedImage); // Float32[768]

// Query time
const textModel = await SiglipTextModel.from_pretrained(
  'Xenova/siglip-base-patch16-512', { dtype: 'q4' }
);
const queryEmbedding = await textModel("page with a dark sidebar"); // Float32[768]
```

### Local captioning via Florence-2 (alternative to Claude API)

Generates rich text descriptions from screenshots locally. Could replace the existing Claude API screenshot analysis, making per-screenshot analysis free and offline.

**Model:** `onnx-community/Florence-2-base-ft` (q4f16)

| Spec | Value |
|---|---|
| Total model size | ~275 MB (q4f16) |
| Speed per screenshot | ~3-5 seconds on Apple Silicon |
| Capabilities | `<CAPTION>`, `<DETAILED_CAPTION>`, `<MORE_DETAILED_CAPTION>`, `<OCR>` |
| Transformers.js support | Yes (marked experimental) |

**Strengths:** Reads text on screen, identifies specific content, structured output
**Weaknesses:** May miss visual layout details that descriptions don't capture

### Using both together

They cover each other's weaknesses:

```
Screenshot captured
       |
       |--- SigLIP vision encoder (~200ms)
       |    -> visual embedding -> vec_screenshots table
       |
       '--- Florence-2 caption + OCR (~4s, async background)
            -> text description -> embed with bge-small -> vec_chunks table
            -> raw text -> FTS5 index
```

### Total model footprint (download size)

| Component | Size |
|---|---|
| SigLIP vision (q4) | ~63 MB |
| SigLIP text (q4) | ~155 MB |
| Florence-2-base (q4f16) | ~275 MB |
| bge-small-en-v1.5 | ~33 MB |
| **Total** | **~526 MB** |

One-time download, cached locally. See [Memory management](#memory-management) for runtime considerations.

---

## Retrieval: hybrid search with Reciprocal Rank Fusion

Three indexes searched in parallel, results fused:

| Index | Type | Finds | Example |
|---|---|---|---|
| `vec_chunks` | bge-small vectors (384d) | Semantically similar text | "authentication code" |
| `vec_screenshots` | SigLIP vectors (768d) | Visually similar images | "page with the blue chart" |
| `recall_fts` | FTS5 keywords | Exact keyword matches | "Recharts", "validateToken" |

### RRF SQL pattern

```sql
WITH fts_matches AS (
  SELECT rowid AS id, row_number() OVER (ORDER BY rank) AS rank_num
  FROM recall_fts WHERE content MATCH :query LIMIT :k
),
vec_matches AS (
  SELECT chunk_id AS id, row_number() OVER (ORDER BY distance) AS rank_num
  FROM vec_chunks WHERE embedding MATCH :query_embedding AND k = :k
),
img_matches AS (
  SELECT chunk_id AS id, row_number() OVER (ORDER BY distance) AS rank_num
  FROM vec_screenshots WHERE embedding MATCH :image_query_embedding AND k = :k
)
-- Reciprocal Rank Fusion (k=60 is standard)
SELECT
  coalesce(f.id, v.id, i.id) AS id,
  coalesce(1.0/(60 + f.rank_num), 0)
    + coalesce(1.0/(60 + v.rank_num), 0)
    + coalesce(1.0/(60 + i.rank_num), 0) AS score
FROM fts_matches f
  FULL OUTER JOIN vec_matches v ON f.id = v.id
  FULL OUTER JOIN img_matches i ON coalesce(f.id, v.id) = i.id
ORDER BY score DESC
LIMIT :k;
```

---

## Proposed schema additions

```sql
-- Chunk table: the source-of-truth for all indexed content
CREATE TABLE recall_chunks (
    id INTEGER PRIMARY KEY,
    entry_id TEXT NOT NULL,            -- FK to entries table
    source_type TEXT NOT NULL,          -- 'screenshot', 'transcription', 'window', 'description'
    content TEXT NOT NULL,              -- text to search/embed
    screenshot_path TEXT,               -- path to image file (if applicable)
    timestamp INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

-- FTS5 index
CREATE VIRTUAL TABLE recall_fts USING fts5(
    content,
    content=recall_chunks,
    content_rowid=id
);

-- Text embedding vectors (bge-small, 384d)
CREATE VIRTUAL TABLE vec_chunks USING vec0(
    chunk_id INTEGER PRIMARY KEY,
    embedding float[384]
);

-- Screenshot visual embedding vectors (SigLIP, 768d)
CREATE VIRTUAL TABLE vec_screenshots USING vec0(
    chunk_id INTEGER PRIMARY KEY,
    embedding float[768]
);
```

---

## Query pipeline (end-to-end)

```
User asks: "What was that charting library I was looking at on Tuesday?"
                              |
              1. Parse time hints ("Tuesday")
                 -> narrow to date range filter
                              |
              2. Parallel retrieval:
                 FTS5: "charting library"
                 vec_chunks: embed(query) -> kNN
                 vec_screenshots: siglip_text_embed(query) -> kNN
                              |
              3. Reciprocal Rank Fusion
                 -> top 10-20 chunks with scores
                              |
              4. Load associated screenshots from disk
                 (only for chunks that have screenshot_path)
                              |
              5. Claude API call:
                 - retrieved text chunks as context
                 - screenshot images inline (base64)
                 - user's question
                              |
              6. Answer with source references
                 (timestamps, clickable screenshot thumbnails)
```

---

## Chunking strategy

| Data source | Chunk strategy | Example |
|---|---|---|
| Window activity | One chunk per activity span | "VS Code - src/hooks/useTimer.ts (12 min)" |
| Screenshot descriptions | One chunk per AI description | "User browsing Recharts docs, viewing BarChart API..." |
| Meeting transcriptions | ~500 token segments | "Sarah mentioned the deadline is moved to Friday..." |
| Time entry descriptions | One chunk per entry | "Worked on authentication flow for the dashboard" |
| Calendar events | One chunk per event | "Sprint planning - 10:00-11:00am" |

---

## Memory management

### The concern

Loading all models simultaneously would consume ~500-600 MB of RAM. Clearical is a background app that runs alongside the user's actual work — it needs to stay lightweight. On 8 GB base-model Macs (where the OS uses ~3-4 GB and the user runs a browser, IDE, Slack, etc.), an extra 500 MB would cause memory pressure and swapping.

### Clearical's current baseline (estimated)

| Component | Typical RAM |
|---|---|
| Electron (Chromium + Node.js) | 150-300 MB |
| React renderer | 50-100 MB |
| SQLite + native module | 20-50 MB |
| **Clearical today** | **~250-450 MB** |

### Strategy: load/unload models on demand

Models should not stay resident. ONNX Runtime sessions can be created and disposed as needed:

| Model | When to load | When to unload | Resident? |
|---|---|---|---|
| **bge-small** (33 MB) | App start | Keep loaded (small enough) | Yes |
| **SigLIP vision** (63 MB) | Screenshot capture | After batch completes | No |
| **SigLIP text** (155 MB) | User opens Recall / runs query | After query completes | No |
| **Florence-2** (275 MB) | Screenshot capture (v2) | After processing completes | No |

**Result:**
- **Idle memory cost: ~33 MB** on top of current baseline (just bge-small for text embedding)
- **During screenshot processing: +63-275 MB** for a few seconds, then released
- **During a Recall query: +155 MB** for a few seconds, then released
- **Total typical footprint: ~300-500 MB**, with brief spikes during processing

### Target memory by Mac configuration

| Mac config | Available after OS + typical apps | Clearical + Recall idle | Acceptable? |
|---|---|---|---|
| 8 GB | ~1-2 GB | ~300-500 MB | Yes (with load/unload strategy) |
| 16 GB | ~6-8 GB | ~300-500 MB | Easily |
| 24-36 GB | Plenty | ~300-500 MB | Not a concern |

### Additional optimizations

**1. Isolate ML work in a utility process**

Run embedding in Electron's `utilityProcess` (or a Node.js `worker_thread`). Isolates memory from the main process. If the worker crashes or leaks, it doesn't bring down the app:

```javascript
const mlWorker = utilityProcess.fork('ml-worker.js');
mlWorker.postMessage({ type: 'embed-image', path: screenshotPath });
mlWorker.on('message', (msg) => {
  // store embedding in SQLite from main process
});
```

**2. Make visual search opt-in**

SigLIP adds 63-155 MB during processing. Most Recall queries will be text-based. Make visual screenshot embedding a setting that users with more RAM can enable. Default off.

**3. Defer Florence-2 to v2**

Existing Claude-generated screenshot descriptions can be text-embedded with bge-small (33 MB). Florence-2 (275 MB) is a future optimization to reduce API costs, not a v1 requirement.

**4. Quantization**

All sizes above assume q4 quantization. Ensure models are loaded with `{ dtype: 'q4' }` — loading fp32 accidentally would be 4-6x worse.

### v1 memory budget

| Component | Size | Loaded | Notes |
|---|---|---|---|
| bge-small-en-v1.5 | 33 MB | Always | Text embedding for all chunk types |
| sqlite-vec | ~2 MB | Always | SQLite extension |
| SigLIP vision | 63 MB | On capture (opt-in) | Load/unload per batch |
| SigLIP text | 155 MB | On query (if visual enabled) | Load/unload per query |
| Florence-2 | — | — | Deferred to v2 |
| **Idle overhead** | **~35 MB** | | |
| **Peak during processing** | **~98-190 MB** | | Brief spikes only |

---

## Electron packaging note

`sqlite-vec` ships a native `.dylib` that must be unpacked from asar:

```json
"asarUnpack": ["node_modules/sqlite-vec-*/**"]
```

Same pattern already used for `better-sqlite3` and `media_monitor.node`.

---

## Models to watch

**Nomic Embed Vision v1.5** (`nomic-ai/nomic-embed-vision-v1.5`)
Shares the exact same embedding space as `nomic-embed-text-v1.5`, which would allow images and text in a single vector table with no separate query model. Currently **broken in Transformers.js** due to ONNX IR version mismatch ([GitHub issue #848](https://github.com/xenova/transformers.js/issues/848)). If fixed, it would simplify the architecture significantly.

**Jina CLIP v2** (`jinaai/jina-clip-v2`)
0.9B params, 1024d, 512x512 input, optimized for documents/screenshots. Currently **has compatibility issues** with Transformers.js (ONNX data file loading errors, crashes on q4). Worth revisiting.

---

## Open questions

- **UI model:** Chat panel? Spotlight-style search bar? Timeline with search?
- **Scope:** Only data captured while timer is running, or also idle periods?
- **Privacy:** Queries send chunk data to Claude API. Is that acceptable for all users? On-device answer generation option?
- **Indexing timing:** Continuous (embed on capture) vs. on-demand (embed on first query)?
- **Premium feature?** Strong candidate for paid tier given API costs for answer generation.
- **Data retention:** How far back should Recall go? Pruning policy?
- **Florence-2 as Claude replacement:** Could Florence-2 local captioning fully replace the existing Claude screenshot analysis step, saving API costs?
- **Embedding model updates:** If a better model comes out, how to handle re-embedding existing data?
