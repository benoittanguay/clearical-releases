# FastVLM Server - Build Quick Start

## Build a Standalone Executable in 3 Steps

### 1. Install Dependencies

```bash
cd python
pip install -r requirements.txt
```

### 2. Download Model

```bash
python download_model.py
```

Wait 5-10 minutes for the ~500MB-1GB model to download.

### 3. Build Executable

```bash
python build_server.py
```

Wait 2-5 minutes for PyInstaller to create the bundle.

## Run the Server

```bash
./python/dist/fastvlm-server/fastvlm-server
```

The server starts on `http://localhost:5123`

## Test It

```bash
# Health check
curl http://localhost:5123/health

# Analyze a screenshot
curl -X POST http://localhost:5123/analyze \
  -H "Content-Type: application/json" \
  -d '{"image_path": "/path/to/screenshot.png"}'
```

## Troubleshooting

### Build fails with "Model directory not found"
```bash
python download_model.py
```

### Executable won't run
```bash
chmod +x python/dist/fastvlm-server/fastvlm-server
```

### Need to rebuild
```bash
python build_server.py --clean
```

## What You Get

- Standalone executable at `python/dist/fastvlm-server/fastvlm-server`
- No Python installation required for end users
- Bundled model (~500MB-1GB)
- Total size: ~1-1.5GB

## Distribution

Zip the entire folder:
```bash
cd python/dist
zip -r fastvlm-server.zip fastvlm-server/
```

End users just unzip and run - no dependencies needed!

## Requirements

- macOS 13+ (Ventura or later)
- Apple Silicon (M1/M2/M3) for best performance
- ~2GB free disk space

## More Info

See [BUILD_README.md](BUILD_README.md) for detailed documentation on the build system.
