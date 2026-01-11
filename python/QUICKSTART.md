# FastVLM Inference Server - Quick Start Guide

Get the FastVLM inference server running in 5 minutes.

## Prerequisites

- macOS with Apple Silicon (M1/M2/M3/M4)
- Python 3.9 or higher

## Quick Setup

### 1. Run the setup script

```bash
cd python/
./setup.sh
```

This will:
- Check your Python version
- Create a virtual environment
- Install all dependencies (FastAPI, uvicorn, mlx-vlm)

### 2. Start the server

```bash
# Activate the virtual environment
source venv/bin/activate

# Start the server
python server.py
```

**First startup**: The model will be downloaded (~500MB). This only happens once.

Expected output:
```
2024-01-11 10:00:00 - __main__ - INFO - Starting server on localhost:5123
2024-01-11 10:00:00 - inference - INFO - Loading FastVLM-0.5B model...
2024-01-11 10:00:15 - inference - INFO - Model loaded successfully and cached
INFO:     Uvicorn running on http://localhost:5123 (Press CTRL+C to quit)
```

### 3. Test the server

In a new terminal:

```bash
# Check health
curl http://localhost:5123/health

# Analyze a screenshot (replace path with your screenshot)
curl -X POST http://localhost:5123/analyze \
  -H "Content-Type: application/json" \
  -d '{"image_path": "/Users/you/Desktop/screenshot.png"}'
```

## Testing

Run the test suite:

```bash
# Basic tests (no image required)
python test_server.py

# Full tests (with image)
python test_server.py --image /path/to/screenshot.png
```

## Common Issues

### "Server not reachable"

Make sure the server is running in another terminal:
```bash
python server.py
```

### "mlx-vlm not installed"

Install dependencies:
```bash
pip install -r requirements.txt
```

### Port 5123 already in use

Use a different port:
```bash
python server.py --port 5124
```

## Next Steps

- Read [README.md](README.md) for detailed documentation
- See integration examples for Electron/TypeScript
- Customize the prompt in `inference.py`

## Stopping the Server

Press `Ctrl+C` in the terminal running the server, or:

```bash
curl -X POST http://localhost:5123/shutdown
```

## Deactivating the Virtual Environment

When you're done:

```bash
deactivate
```
