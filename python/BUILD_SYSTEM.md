# PyInstaller Build System for FastVLM Server

Complete PyInstaller-based build system for creating a standalone macOS executable of the FastVLM Python server with the bundled nanoLLaVA model.

## Quick Start

### Option 1: Automated Workflow (Recommended)

Run the automated build script that handles everything:

```bash
cd python
chmod +x example_build_workflow.sh
./example_build_workflow.sh
```

This script will:
- Check Python version
- Create virtual environment
- Install dependencies
- Download the model
- Build the executable
- Test the build
- Display usage instructions

### Option 2: Manual Build (Step by Step)

```bash
cd python

# 1. Verify setup
python verify_build_setup.py

# 2. Download model (~5-10 minutes)
python download_model.py

# 3. Build executable (~2-5 minutes)
python build_server.py

# 4. Run the executable
./dist/fastvlm-server/fastvlm-server
```

## What You Get

After building, you'll have a standalone executable at:
```
python/dist/fastvlm-server/fastvlm-server
```

Features:
- No Python installation required
- All dependencies bundled (MLX, MLX-VLM, FastAPI, etc.)
- nanoLLaVA model included (~500MB-1GB)
- Works offline (no internet needed)
- Total size: ~1-1.5GB
- Platform: macOS arm64 (Apple Silicon)

## Build System Files

### Core Scripts

1. **`download_model.py`** - Downloads nanoLLaVA model from HuggingFace
   ```bash
   python download_model.py
   ```

2. **`build_server.py`** - Builds the standalone executable
   ```bash
   python build_server.py [--clean]
   ```

3. **`fastvlm.spec`** - PyInstaller configuration file
   - Configures bundling of all dependencies
   - Includes model files
   - Targets macOS arm64

4. **`verify_build_setup.py`** - Verifies build system is ready
   ```bash
   python verify_build_setup.py
   ```

5. **`example_build_workflow.sh`** - Automated end-to-end workflow
   ```bash
   ./example_build_workflow.sh
   ```

### Documentation

- **`BUILD_README.md`** - Comprehensive build system documentation
  - Prerequisites and requirements
  - Detailed build instructions
  - API usage and examples
  - Troubleshooting guide
  - Technical architecture details

- **`BUILD_QUICKSTART.md`** - Quick reference guide
  - 3-step build process
  - Common commands
  - Quick troubleshooting

- **`BUILD_SUMMARY.md`** - Complete system overview
  - What was created
  - Key features
  - File structure
  - Performance metrics
  - Next steps

- **`BUILD_SYSTEM.md`** - This file
  - Entry point to build system
  - Quick navigation
  - Overview of all files

### Updated Files

- **`inference.py`** - Updated with smart model loading
  - Bundled model support
  - Local model fallback
  - HuggingFace fallback

- **`requirements.txt`** - Added build dependencies
  - `pyinstaller>=6.0.0`
  - `huggingface_hub>=0.20.0`

- **`.gitignore`** - Added build artifacts
  - `build/`, `dist/`
  - `models/`

## Prerequisites

### System Requirements

- macOS (Apple Silicon recommended)
- Python 3.8 or higher
- ~2GB free disk space
- Internet connection (for model download)

### Install Dependencies

```bash
cd python
pip install -r requirements.txt
```

This installs:
- MLX and MLX-VLM (Apple Silicon ML frameworks)
- FastAPI and Uvicorn (Web server)
- PyInstaller (Executable builder)
- HuggingFace Hub (Model downloader)
- Other dependencies

## Build Process

### Step 1: Verify Setup

```bash
python verify_build_setup.py
```

This checks:
- Python version (3.8+)
- All required packages installed
- All build files present
- File updates applied correctly

### Step 2: Download Model

```bash
python download_model.py
```

Downloads `qnguyen3/nanoLLaVA` model (~500MB-1GB) to `python/models/nanoLLaVA/`

Expected time: 5-10 minutes

### Step 3: Build Executable

```bash
python build_server.py
```

Or for a clean rebuild:
```bash
python build_server.py --clean
```

This:
- Checks prerequisites
- Runs PyInstaller with custom spec
- Bundles all dependencies and model
- Verifies the build
- Reports statistics

Expected time: 2-5 minutes

### Step 4: Test the Build

```bash
# Start the server
./dist/fastvlm-server/fastvlm-server

# In another terminal, test it
curl http://localhost:5123/health
```

## Using the Executable

### Running the Server

```bash
# Default (localhost:5123)
./dist/fastvlm-server/fastvlm-server

# Custom port
./dist/fastvlm-server/fastvlm-server --port 8000

# Custom host and port
./dist/fastvlm-server/fastvlm-server --host 0.0.0.0 --port 8000
```

### API Endpoints

- `GET /` - Server information
- `GET /health` - Health check
- `POST /analyze` - Analyze screenshot
- `POST /shutdown` - Graceful shutdown

### Example Usage

```bash
# Start server
./dist/fastvlm-server/fastvlm-server &

# Wait for startup
sleep 10

# Health check
curl http://localhost:5123/health

# Analyze screenshot
curl -X POST http://localhost:5123/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "image_path": "/path/to/screenshot.png",
    "max_tokens": 200,
    "temperature": 0.7
  }'

# Shutdown
curl -X POST http://localhost:5123/shutdown
```

## Distribution

### Create Distribution Archive

```bash
cd python/dist
zip -r fastvlm-server.zip fastvlm-server/
```

Or with date:
```bash
zip -r fastvlm-server-$(date +%Y%m%d).zip fastvlm-server/
```

### End User Requirements

End users need:
- macOS 13+ (Ventura or later)
- Apple Silicon (M1/M2/M3/M4)
- ~1.5GB free disk space
- No Python installation
- No pip packages
- No internet connection

### Installation for End Users

1. Unzip the archive
2. Make executable: `chmod +x fastvlm-server/fastvlm-server`
3. Run: `./fastvlm-server/fastvlm-server`

That's it!

## Troubleshooting

### Quick Fixes

#### "Model directory not found"
```bash
python download_model.py
```

#### "Package not installed"
```bash
pip install -r requirements.txt
```

#### "Executable won't run"
```bash
chmod +x dist/fastvlm-server/fastvlm-server
```

#### "Need clean rebuild"
```bash
python build_server.py --clean
```

### Detailed Troubleshooting

See `BUILD_README.md` for comprehensive troubleshooting guide covering:
- Model download issues
- Build failures
- Runtime issues
- Platform-specific problems

## Documentation Guide

- **Getting Started**: Read this file (BUILD_SYSTEM.md)
- **Quick Build**: See `BUILD_QUICKSTART.md`
- **Detailed Guide**: See `BUILD_README.md`
- **System Overview**: See `BUILD_SUMMARY.md`
- **Development**: See main `README.md` and `QUICKSTART.md`

## Performance

### Build Performance

- Model download: 5-10 minutes
- PyInstaller build: 2-5 minutes
- Total first build: 10-15 minutes
- Rebuild (cached): 2-5 minutes

### Runtime Performance

- Startup time: 5-10 seconds (model loading)
- Memory usage: ~500MB idle, ~800MB peak
- Inference: 50-100ms per screenshot (M1/M2/M3)

## Architecture

### Model Loading Strategy

1. **Bundled mode** (production) - Loads from executable bundle
2. **Local mode** (development) - Loads from `python/models/nanoLLaVA/`
3. **Fallback mode** - Downloads from HuggingFace if needed

### Bundle Structure

```
dist/fastvlm-server/
├── fastvlm-server              # Executable
├── models/
│   └── nanoLLaVA/             # Bundled model
└── _internal/                  # Dependencies
    ├── Python runtime
    ├── MLX frameworks
    └── Python packages
```

### Dependencies Bundled

- MLX (Apple Silicon ML)
- MLX-VLM (Vision-language models)
- FastAPI (Web framework)
- Uvicorn (ASGI server)
- Pydantic (Data validation)
- Pillow (Image processing)
- Transformers (Model utilities)
- NumPy (Array operations)

## Development vs Production

### Development Mode

```bash
# Install dependencies once
pip install -r requirements.txt

# Download model once
python download_model.py

# Run directly from source
python server.py

# Edit code and restart - no rebuild needed
```

### Production Mode

```bash
# Build once
python build_server.py

# Distribute the bundle
cd dist && zip -r fastvlm-server.zip fastvlm-server/

# End users run the executable
./fastvlm-server/fastvlm-server
```

## CI/CD Integration

Example build script for automation:

```bash
#!/bin/bash
set -e

cd python

# Install dependencies
pip install -r requirements.txt

# Download model
python download_model.py

# Build executable
python build_server.py --clean

# Create distribution
cd dist
zip -r fastvlm-server-$(date +%Y%m%d).zip fastvlm-server/

# Upload to distribution server
# scp fastvlm-server-*.zip user@server:/path/
```

## Next Steps

### To Build Now

1. Run verification:
   ```bash
   python verify_build_setup.py
   ```

2. If verification passes, run automated build:
   ```bash
   ./example_build_workflow.sh
   ```

3. Or build manually:
   ```bash
   python download_model.py
   python build_server.py
   ```

### To Customize

- **Change model**: Edit `download_model.py` and `inference.py`
- **Add dependencies**: Update `requirements.txt` and `fastvlm.spec`
- **Modify build**: Edit `fastvlm.spec` and `build_server.py`
- **Target platform**: Change `target_arch` in `fastvlm.spec`

### To Distribute

1. Build the executable
2. Test thoroughly
3. Create distribution archive
4. Write end-user documentation
5. Distribute (DMG, PKG, or ZIP)

## Support

### Resources

- PyInstaller: https://pyinstaller.org/
- MLX-VLM: https://github.com/Blaizzy/mlx-vlm
- nanoLLaVA: https://huggingface.co/qnguyen3/nanoLLaVA
- FastAPI: https://fastapi.tiangolo.com/

### Getting Help

1. Check `BUILD_README.md` troubleshooting section
2. Run `python verify_build_setup.py` to diagnose issues
3. Review build logs in `build/` directory
4. Check PyInstaller documentation for build issues

## License

Ensure compliance with all dependency licenses when distributing:
- PyInstaller: GNU GPL v2 with exception
- MLX: Apple MIT License
- FastAPI: MIT License
- Check model license on HuggingFace

---

**Version**: 1.0.0
**Date**: 2026-01-11
**Platform**: macOS arm64 (Apple Silicon)
**Python**: 3.8+
