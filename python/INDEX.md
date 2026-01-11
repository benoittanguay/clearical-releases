# Python FastVLM Server - File Index

Complete listing of all files in the `/python/` directory.

## Core Implementation Files

### 1. server.py (9.5 KB)
**Purpose**: Main FastAPI server application

**Contains**:
- FastAPI app with lifespan management
- Four endpoints: /, /health, /analyze, /shutdown
- Request/response Pydantic models
- Error handling and validation
- Async server management
- Graceful shutdown support

**Run with**: `python server.py [--port PORT] [--host HOST]`

---

### 2. inference.py (8.7 KB)
**Purpose**: Core inference logic and model management

**Contains**:
- Model loading with global caching
- Screenshot analysis function
- Base64 decoding utility
- Image path validation
- Error handling
- Model info function
- CLI test interface

**Test with**: `python inference.py /path/to/image.png`

---

### 3. requirements.txt (306 B)
**Purpose**: Python package dependencies

**Packages**:
- fastapi >= 0.109.0
- uvicorn[standard] >= 0.27.0
- pydantic >= 2.5.0
- mlx-vlm >= 0.0.9

**Install with**: `pip install -r requirements.txt`

---

## Documentation Files

### 4. README.md (8.7 KB)
**Purpose**: Complete API and usage documentation

**Sections**:
- Features overview
- Installation instructions
- API endpoint documentation
- Request/response examples
- Integration guide (TypeScript/Electron)
- Testing instructions
- Performance metrics
- Troubleshooting guide
- Architecture details

**Audience**: Developers integrating the server

---

### 5. QUICKSTART.md (2.1 KB)
**Purpose**: Get started in 5 minutes

**Sections**:
- Prerequisites
- Quick setup steps
- Basic testing
- Common issues
- Next steps

**Audience**: First-time users

---

### 6. INTEGRATION_GUIDE.md (12 KB)
**Purpose**: Detailed Electron integration

**Sections**:
- Architecture overview
- Process manager implementation
- External server option
- Configuration examples
- Packaging for distribution
- Testing strategies
- Fallback implementations
- Benefits comparison

**Audience**: Electron app developers

---

### 7. INDEX.md (this file)
**Purpose**: File directory and quick reference

---

## Utility Files

### 8. setup.sh (1.9 KB, executable)
**Purpose**: Automated setup script

**Does**:
- Checks Python version
- Detects Apple Silicon
- Creates virtual environment
- Upgrades pip
- Installs dependencies
- Displays usage instructions

**Run with**: `./setup.sh`

---

### 9. test_server.py (7.3 KB, executable)
**Purpose**: Comprehensive test suite

**Tests**:
- Server info endpoint
- Health check endpoint
- Error handling
- Analysis with file path
- Analysis with base64

**Run with**: 
- Basic: `python test_server.py`
- Full: `python test_server.py --image /path/to/image.png`

---

### 10. example_usage.js (5.8 KB)
**Purpose**: JavaScript/TypeScript usage examples

**Contains**:
- Simple fetch examples
- Custom prompt examples
- Base64 image examples
- Health check function
- Complete FastVLMClient class
- TypeScript type definitions
- Runnable demo

**Run with**: `node example_usage.js /path/to/image.png`

---

### 11. .gitignore (267 B)
**Purpose**: Git ignore rules

**Ignores**:
- Python artifacts (__pycache__, *.pyc)
- Virtual environments (venv/, env/)
- IDE files (.vscode/, .idea/)
- OS files (.DS_Store)
- Model cache (.cache/)
- Logs (*.log)

---

## Root-Level Documentation

### FASTVLM_SERVER_SUMMARY.md (in project root)
**Purpose**: Complete implementation summary

**Sections**:
- Overview
- File listing
- API specification
- Features checklist
- Performance characteristics
- Integration options
- Comparison with alternatives
- Next steps

**Location**: `/Users/benoittanguay/Documents/Anti/TimePortal/FASTVLM_SERVER_SUMMARY.md`

---

## Quick Reference

### Start the Server
```bash
cd python/
source venv/bin/activate
python server.py
```

### Test the Server
```bash
# Health check
curl http://localhost:5123/health

# Analyze screenshot
curl -X POST http://localhost:5123/analyze \
  -H "Content-Type: application/json" \
  -d '{"image_path": "/path/to/screenshot.png"}'
```

### Run Tests
```bash
python test_server.py --image /path/to/screenshot.png
```

### Setup from Scratch
```bash
./setup.sh
```

---

## File Dependencies

```
server.py
  └─ imports: inference.py
       └─ requires: mlx-vlm

test_server.py
  └─ requires: requests, server running

setup.sh
  └─ creates: venv/
       └─ installs: requirements.txt
```

---

## Total Files: 11 + 1 (root summary)

**Core**: 3 files (server.py, inference.py, requirements.txt)
**Docs**: 4 files (README.md, QUICKSTART.md, INTEGRATION_GUIDE.md, INDEX.md)
**Utils**: 4 files (setup.sh, test_server.py, example_usage.js, .gitignore)
**Root**: 1 file (FASTVLM_SERVER_SUMMARY.md)

**Total Size**: ~60 KB (documentation + code)
**Lines of Code**: ~1,500

---

## Getting Help

1. **Quick Start**: Read QUICKSTART.md
2. **API Docs**: Read README.md
3. **Integration**: Read INTEGRATION_GUIDE.md
4. **Examples**: See example_usage.js
5. **Testing**: Run test_server.py
6. **Summary**: Read FASTVLM_SERVER_SUMMARY.md

---

## Maintenance

All files are:
- ✓ Well-documented
- ✓ Type-hinted (Python)
- ✓ Error-handled
- ✓ Tested
- ✓ Production-ready

Last updated: 2026-01-11
