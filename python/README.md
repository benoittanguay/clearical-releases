# FastVLM Inference Server

A lightweight FastAPI server that provides screenshot analysis using the FastVLM-0.5B model (nanoLLaVA) via mlx-vlm. Optimized for Apple Silicon Macs.

## Features

- **On-Device Inference**: Runs completely locally on Apple Silicon
- **FastVLM-0.5B Model**: Compact vision-language model optimized for efficiency
- **RESTful API**: Simple HTTP endpoints for integration
- **Model Caching**: Loads model once at startup, reuses for all requests
- **Error Handling**: Comprehensive error handling and validation
- **Health Checks**: Monitor server and model status
- **Graceful Shutdown**: Clean shutdown endpoint for testing

## Requirements

- **macOS** with Apple Silicon (M1/M2/M3/M4)
- **Python 3.9+**
- **pip** or **conda** package manager

## Installation

### 1. Create a Virtual Environment (Recommended)

```bash
cd python/
python3 -m venv venv
source venv/bin/activate  # On macOS/Linux
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

This will install:
- `fastapi` - Web framework
- `uvicorn` - ASGI server
- `pydantic` - Data validation
- `mlx-vlm` - MLX-based vision-language models

### 3. Verify Installation

```bash
python -c "import mlx_vlm; print('mlx-vlm installed successfully')"
```

## Usage

### Starting the Server

**Default (localhost:5123):**
```bash
python server.py
```

**Custom port:**
```bash
python server.py --port 8000
```

**Custom host and port:**
```bash
python server.py --host 0.0.0.0 --port 5123
```

### Server Output

```
2024-01-11 10:00:00 - __main__ - INFO - Starting server on localhost:5123
2024-01-11 10:00:00 - __main__ - INFO - Starting FastVLM Inference Server...
2024-01-11 10:00:00 - __main__ - INFO - Loading model at startup...
2024-01-11 10:00:05 - inference - INFO - Loading FastVLM-0.5B model...
2024-01-11 10:00:15 - inference - INFO - Model loaded successfully and cached
INFO:     Started server process [12345]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://localhost:5123 (Press CTRL+C to quit)
```

**Note**: First startup will download the model (~500MB) from HuggingFace. Subsequent starts are much faster.

## API Endpoints

### GET / - Server Information

Get server details and available endpoints.

```bash
curl http://localhost:5123/
```

**Response:**
```json
{
  "name": "FastVLM Inference Server",
  "version": "1.0.0",
  "description": "Screenshot analysis using FastVLM-0.5B model",
  "model": {
    "model_name": "FastVLM-0.5B (nanoLLaVA)",
    "model_id": "qnguyen3/nanoLLaVA",
    "framework": "mlx-vlm",
    "loaded": true,
    "device": "Apple Silicon (MLX)"
  },
  "endpoints": { ... }
}
```

### GET /health - Health Check

Check if the server is ready and the model is loaded.

```bash
curl http://localhost:5123/health
```

**Response:**
```json
{
  "status": "healthy",
  "model_loaded": true,
  "model_info": {
    "model_name": "FastVLM-0.5B (nanoLLaVA)",
    "loaded": true
  }
}
```

### POST /analyze - Analyze Screenshot

Analyze a screenshot and generate a description.

**Request with file path:**
```bash
curl -X POST http://localhost:5123/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "image_path": "/path/to/screenshot.png"
  }'
```

**Request with base64 image:**
```bash
curl -X POST http://localhost:5123/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "image_base64": "iVBORw0KGgoAAAANS..."
  }'
```

**Request with custom prompt:**
```bash
curl -X POST http://localhost:5123/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "image_path": "/path/to/screenshot.png",
    "prompt": "Describe the code visible in this IDE screenshot.",
    "max_tokens": 300,
    "temperature": 0.5
  }'
```

**Response:**
```json
{
  "description": "The user is working in Visual Studio Code on a TypeScript project. They are editing a file called 'server.py' which contains FastAPI server code. The screenshot shows error handling implementation and endpoint definitions.",
  "confidence": 0.85,
  "success": true
}
```

**Error Response:**
```json
{
  "description": "",
  "confidence": 0.0,
  "success": false,
  "error": "Image file not found: /invalid/path.png"
}
```

### POST /shutdown - Graceful Shutdown

Gracefully shutdown the server (useful for testing).

```bash
curl -X POST http://localhost:5123/shutdown
```

**Response:**
```json
{
  "message": "Server shutting down..."
}
```

## Request Parameters

### AnalyzeRequest

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `image_path` | string | One of image_path or image_base64 | None | Path to screenshot PNG file |
| `image_base64` | string | One of image_path or image_base64 | None | Base64-encoded image data |
| `prompt` | string | No | Default prompt | Custom analysis prompt |
| `max_tokens` | integer | No | 200 | Max tokens to generate (50-1000) |
| `temperature` | float | No | 0.7 | Sampling temperature (0.0-2.0) |

## Integration with Clearical

### TypeScript/Electron Example

```typescript
// electron/fastvlmService.ts

interface AnalyzeResponse {
  description: string;
  confidence: number;
  success: boolean;
  error?: string;
}

async function analyzeScreenshot(imagePath: string): Promise<AnalyzeResponse> {
  const response = await fetch('http://localhost:5123/analyze', {
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
    throw new Error(`Server error: ${response.status}`);
  }

  return await response.json();
}

// Usage in main process
const result = await analyzeScreenshot('/path/to/screenshot.png');
if (result.success) {
  console.log(`Description: ${result.description}`);
  console.log(`Confidence: ${result.confidence}`);
}
```

## Testing

### Test with Sample Image

```bash
# Using the inference module directly
python inference.py /path/to/screenshot.png
```

### Test the Server

```bash
# Terminal 1: Start server
python server.py

# Terminal 2: Test health check
curl http://localhost:5123/health

# Terminal 3: Test analysis
curl -X POST http://localhost:5123/analyze \
  -H "Content-Type: application/json" \
  -d '{"image_path": "/Users/you/Desktop/screenshot.png"}'
```

## Performance

- **Model Loading**: ~10-20 seconds (first startup only)
- **Inference Time**: ~1-3 seconds per screenshot
- **Memory Usage**: ~1-2 GB RAM
- **Model Size**: ~500 MB on disk

## Troubleshooting

### Model Download Fails

**Issue**: Network error during model download

**Solution**: Check internet connection and try again. The model is downloaded from HuggingFace Hub.

### "mlx-vlm not installed" Error

**Issue**: Package not found

**Solution**:
```bash
pip install mlx-vlm
```

### Server Won't Start on Port 5123

**Issue**: Port already in use

**Solution**: Use a different port:
```bash
python server.py --port 5124
```

### Slow Inference

**Issue**: Each request takes >5 seconds

**Solution**: Ensure you're on Apple Silicon. Intel Macs are not optimized for MLX.

### Image Not Found Error

**Issue**: `FileNotFoundError` when analyzing

**Solution**: Use absolute paths, not relative paths:
```bash
# Good
"/Users/you/Documents/screenshot.png"

# Bad (may not work)
"./screenshot.png"
```

## Architecture

### Model: FastVLM-0.5B (nanoLLaVA)

- **Size**: 0.5 billion parameters
- **Framework**: MLX (Apple's ML framework)
- **Optimization**: Quantized for efficiency
- **Capabilities**: Vision + language understanding

### Server Stack

- **FastAPI**: Modern, async Python web framework
- **Uvicorn**: High-performance ASGI server
- **Pydantic**: Data validation and serialization
- **MLX-VLM**: Vision-language model inference

## Development

### Project Structure

```
python/
├── server.py           # FastAPI server
├── inference.py        # Core inference logic
├── requirements.txt    # Python dependencies
├── README.md          # This file
└── test_server.py     # Test script (optional)
```

### Adding Custom Prompts

Edit the `DEFAULT_PROMPT` in `inference.py`:

```python
DEFAULT_PROMPT = """Your custom prompt here..."""
```

### Logging

Logs are written to stdout. Adjust log level in `server.py`:

```python
logging.basicConfig(level=logging.DEBUG)  # More verbose
```

## Privacy & Security

- **Local Processing**: All inference happens on-device
- **No Data Sent**: No screenshots sent to external APIs
- **localhost Only**: Server binds to localhost by default
- **Open Source**: All code is inspectable

## License

This server is part of the Clearical project. See main project LICENSE.

## Support

For issues or questions:
1. Check this README
2. Review server logs
3. Test with the inference module directly
4. Open an issue in the main repository
