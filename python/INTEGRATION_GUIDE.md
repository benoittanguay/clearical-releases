# Integration Guide: FastVLM Server with Clearical Electron App

This guide shows how to integrate the FastVLM inference server with the Clearical Electron application.

## Architecture Overview

The integration adds a third option for screenshot analysis:

1. **Apple Intelligence** (current) - On-device Swift + NaturalLanguage
2. **Claude API** (previously used) - Cloud-based LLM
3. **FastVLM Server** (new) - Local Python server with MLX-VLM

## Integration Approach

### Option 1: Process Manager Integration (Recommended)

The Electron app manages the Python server lifecycle automatically.

#### Implementation Steps

1. **Create a FastVLM Service** (`electron/fastvlmService.ts`):

```typescript
// electron/fastvlmService.ts
import { spawn, ChildProcess } from 'child_process';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

interface AnalyzeResponse {
  description: string;
  confidence: number;
  success: boolean;
  error?: string;
}

class FastVLMService {
  private serverProcess: ChildProcess | null = null;
  private serverPort: number = 5123;
  private serverUrl: string = `http://localhost:${this.serverPort}`;
  private isReady: boolean = false;

  constructor() {}

  /**
   * Start the FastVLM server as a child process
   */
  async start(): Promise<void> {
    // Check if Python server exists
    const pythonDir = path.join(app.getAppPath(), '..', 'python');
    const serverScript = path.join(pythonDir, 'server.py');

    if (!fs.existsSync(serverScript)) {
      throw new Error('FastVLM server script not found');
    }

    // Check if virtual environment exists
    const venvPython = path.join(pythonDir, 'venv', 'bin', 'python');
    const pythonExec = fs.existsSync(venvPython) ? venvPython : 'python3';

    console.log('[FastVLM] Starting server...');

    // Spawn the Python server
    this.serverProcess = spawn(pythonExec, [serverScript, '--port', this.serverPort.toString()], {
      cwd: pythonDir,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Handle server output
    this.serverProcess.stdout?.on('data', (data) => {
      console.log(`[FastVLM] ${data.toString().trim()}`);
    });

    this.serverProcess.stderr?.on('data', (data) => {
      console.error(`[FastVLM Error] ${data.toString().trim()}`);
    });

    this.serverProcess.on('error', (err) => {
      console.error('[FastVLM] Process error:', err);
    });

    this.serverProcess.on('exit', (code) => {
      console.log(`[FastVLM] Server exited with code ${code}`);
      this.isReady = false;
    });

    // Wait for server to be ready
    await this.waitForReady();
  }

  /**
   * Wait for the server to become ready
   */
  private async waitForReady(maxWaitMs: number = 30000): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 500;

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const response = await fetch(`${this.serverUrl}/health`);
        if (response.ok) {
          const data = await response.json();
          if (data.status === 'healthy' && data.model_loaded) {
            this.isReady = true;
            console.log('[FastVLM] Server is ready');
            return;
          }
        }
      } catch (err) {
        // Server not ready yet, continue waiting
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    throw new Error('FastVLM server failed to start within timeout');
  }

  /**
   * Stop the FastVLM server
   */
  async stop(): Promise<void> {
    if (!this.serverProcess) {
      return;
    }

    console.log('[FastVLM] Stopping server...');

    try {
      // Try graceful shutdown first
      await fetch(`${this.serverUrl}/shutdown`, { method: 'POST' });
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err) {
      // Ignore errors during shutdown
    }

    // Force kill if still running
    if (this.serverProcess && !this.serverProcess.killed) {
      this.serverProcess.kill('SIGTERM');
    }

    this.serverProcess = null;
    this.isReady = false;
  }

  /**
   * Analyze a screenshot
   */
  async analyzeScreenshot(imagePath: string): Promise<AnalyzeResponse> {
    if (!this.isReady) {
      throw new Error('FastVLM server not ready');
    }

    try {
      const response = await fetch(`${this.serverUrl}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_path: imagePath,
          max_tokens: 200,
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Analysis failed');
      }

      return await response.json();

    } catch (error) {
      console.error('[FastVLM] Analysis error:', error);
      throw error;
    }
  }

  /**
   * Check if server is healthy
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.serverUrl}/health`);
      if (response.ok) {
        const data = await response.json();
        return data.status === 'healthy';
      }
    } catch (err) {
      return false;
    }
    return false;
  }
}

// Singleton instance
let fastVLMService: FastVLMService | null = null;

export function getFastVLMService(): FastVLMService {
  if (!fastVLMService) {
    fastVLMService = new FastVLMService();
  }
  return fastVLMService;
}
```

2. **Update main.ts** to start/stop the service:

```typescript
// electron/main.ts

import { getFastVLMService } from './fastvlmService.js';

// At app startup
app.whenReady().then(async () => {
  // ... other initialization ...

  // Start FastVLM server (optional, based on user preference)
  const useFastVLM = process.env.USE_FASTVLM === 'true';
  if (useFastVLM) {
    try {
      const fastVLM = getFastVLMService();
      await fastVLM.start();
      console.log('[Main] FastVLM server started');
    } catch (error) {
      console.error('[Main] Failed to start FastVLM server:', error);
    }
  }
});

// At app shutdown
app.on('before-quit', async (event) => {
  const fastVLM = getFastVLMService();
  if (fastVLM) {
    event.preventDefault();
    await fastVLM.stop();
    app.quit();
  }
});
```

3. **Update screenshot analysis** to use FastVLM:

```typescript
// electron/main.ts - in your screenshot analysis handler

async function analyzeScreenshot(imagePath: string) {
  // Choose analysis method based on configuration
  const analysisMethod = process.env.ANALYSIS_METHOD || 'apple-intelligence';

  if (analysisMethod === 'fastvlm') {
    try {
      const fastVLM = getFastVLMService();
      const result = await fastVLM.analyzeScreenshot(imagePath);

      return {
        description: result.description,
        rawVisionData: { /* ... */ },
        aiDescription: result.description,
        confidence: result.confidence,
        llmError: null
      };
    } catch (error) {
      console.error('[Main] FastVLM analysis failed:', error);
      // Fallback to Apple Intelligence
    }
  }

  // Fallback to existing Apple Intelligence logic
  const visionResult = await analyzeScreenshotWithSwift(imagePath);
  return visionResult;
}
```

### Option 2: External Server (Manual)

User manages the Python server separately.

#### Usage

1. User starts the server manually:
   ```bash
   cd python/
   source venv/bin/activate
   python server.py
   ```

2. Electron app checks if server is available:

```typescript
// Check if FastVLM server is running
async function isFastVLMAvailable(): Promise<boolean> {
  try {
    const response = await fetch('http://localhost:5123/health');
    return response.ok;
  } catch {
    return false;
  }
}

// Use it if available, otherwise fallback
const useFastVLM = await isFastVLMAvailable();
```

## Configuration

Add to `.env.local`:

```bash
# Analysis method: apple-intelligence, claude-api, or fastvlm
ANALYSIS_METHOD=fastvlm

# Auto-start FastVLM server (for Option 1)
USE_FASTVLM=true

# FastVLM server settings
FASTVLM_PORT=5123
```

## Packaging for Distribution

To include the Python server in your Electron build:

### 1. Update electron-builder configuration

In `package.json`:

```json
{
  "build": {
    "extraResources": [
      {
        "from": "python/",
        "to": "python",
        "filter": [
          "**/*",
          "!venv/**",
          "!__pycache__/**",
          "!*.pyc",
          "!.DS_Store"
        ]
      }
    ]
  }
}
```

### 2. Include Python dependencies

Create a standalone Python distribution:

```bash
cd python/
./setup.sh

# Create a relocatable venv (for distribution)
# This ensures the venv can be moved to different paths
```

### 3. Runtime path resolution

```typescript
// electron/fastvlmService.ts

import { app } from 'electron';
import * as path from 'path';

function getPythonServerPath(): string {
  if (app.isPackaged) {
    // Production: use bundled resources
    return path.join(process.resourcesPath, 'python');
  } else {
    // Development: use project directory
    return path.join(app.getAppPath(), '..', 'python');
  }
}
```

## Testing

### Test the service independently

```bash
cd python/
source venv/bin/activate
python server.py
```

In another terminal:
```bash
curl http://localhost:5123/health
```

### Test from Electron

```typescript
// In main.ts or renderer
const result = await getFastVLMService().analyzeScreenshot('/path/to/screenshot.png');
console.log(result.description);
```

## Performance Considerations

- **First analysis**: Slower (~10-20s) due to model loading
- **Subsequent analyses**: Fast (~1-3s per screenshot)
- **Memory**: Server uses ~1-2GB RAM when running
- **Startup time**: Add ~5-10s to app startup if auto-starting server

## Fallback Strategy

Recommended fallback order:

1. FastVLM (if enabled and available)
2. Apple Intelligence (always available on macOS)
3. Basic description from filename

```typescript
async function analyzeWithFallback(imagePath: string) {
  // Try FastVLM
  if (process.env.USE_FASTVLM === 'true') {
    try {
      const fastVLM = getFastVLMService();
      return await fastVLM.analyzeScreenshot(imagePath);
    } catch (error) {
      console.warn('FastVLM failed, falling back to Apple Intelligence');
    }
  }

  // Fallback to Apple Intelligence
  return await analyzeScreenshotWithSwift(imagePath);
}
```

## Troubleshooting

### Server won't start

- Check Python installation: `python3 --version`
- Verify dependencies: `pip list | grep mlx-vlm`
- Check port availability: `lsof -i :5123`

### Server crashes

- Check logs in Electron console
- Run server manually to see errors: `python server.py`
- Verify model downloaded: Check `~/.cache/huggingface/`

### Slow inference

- Ensure you're on Apple Silicon
- Model should be loaded at startup (check logs)
- First inference always slower (model loading)

## Benefits vs. Trade-offs

### FastVLM Server
**Pros:**
- Better quality than Apple Intelligence heuristics
- More privacy than Claude API (local processing)
- Customizable prompts
- No per-request costs

**Cons:**
- Requires Python installation
- Adds complexity to app distribution
- Higher memory usage
- Slower startup

### Apple Intelligence
**Pros:**
- Zero setup required
- Fast (native code)
- Always available
- No additional memory

**Cons:**
- Heuristic-based (lower quality)
- Limited customization

### Claude API
**Pros:**
- Highest quality descriptions
- No local resources needed
- Simple integration

**Cons:**
- Requires internet + API key
- Privacy concerns
- Per-request costs
- Rate limits

## Recommended Configuration

For most users:
- **Default**: Apple Intelligence (zero setup)
- **Power users**: FastVLM (best quality + privacy)
- **Enterprise**: Claude API (highest quality)

Let users choose in Settings UI.
