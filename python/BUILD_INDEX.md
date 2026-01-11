# Build System - Complete File Index

Quick reference guide to all build system files and their purposes.

## Quick Access Links

- **Start Here**: [BUILD_SYSTEM.md](BUILD_SYSTEM.md) - Main build system documentation
- **Quick Start**: [BUILD_QUICKSTART.md](BUILD_QUICKSTART.md) - 3-step build guide
- **Detailed Guide**: [BUILD_README.md](BUILD_README.md) - Comprehensive documentation
- **Overview**: [BUILD_SUMMARY.md](BUILD_SUMMARY.md) - Complete system summary

## Core Build Files

### Executable Scripts

| File | Size | Purpose | Usage |
|------|------|---------|-------|
| `download_model.py` | 4.6K | Downloads nanoLLaVA model from HuggingFace | `python download_model.py` |
| `build_server.py` | 9.6K | Main build script - orchestrates PyInstaller | `python build_server.py [--clean]` |
| `verify_build_setup.py` | 10K | Verifies build system is ready | `python verify_build_setup.py` |
| `example_build_workflow.sh` | 5.0K | Automated end-to-end build workflow | `./example_build_workflow.sh` |

### Configuration Files

| File | Size | Purpose | Usage |
|------|------|---------|-------|
| `fastvlm.spec` | 3.9K | PyInstaller specification file | Used by PyInstaller |
| `requirements.txt` | 404B | Python dependencies (updated) | `pip install -r requirements.txt` |
| `.gitignore` | 394B | Git ignore patterns (updated) | Automatic |

### Source Files

| File | Size | Purpose | Status |
|------|------|---------|--------|
| `inference.py` | 11K | Inference module with model loading | Updated with `get_model_path()` |
| `server.py` | - | FastAPI server | Unchanged |

## Documentation Files

### Main Documentation

| File | Size | Purpose | Audience |
|------|------|---------|----------|
| `BUILD_SYSTEM.md` | 9.7K | Main build system guide | Everyone |
| `BUILD_README.md` | 12K | Comprehensive documentation | Developers |
| `BUILD_QUICKSTART.md` | 1.6K | Quick reference guide | Quick users |
| `BUILD_SUMMARY.md` | 11K | Complete system overview | Technical users |
| `BUILD_INDEX.md` | This file | File navigation index | Everyone |

### Content Guide

#### BUILD_SYSTEM.md (Start Here)
- Quick start options (automated vs manual)
- Build system files overview
- Prerequisites and setup
- Build process steps
- Running the executable
- Distribution guide
- Troubleshooting quick fixes
- Development vs production
- CI/CD integration

#### BUILD_README.md (Comprehensive)
- Detailed prerequisites
- Step-by-step build process
- Complete usage examples
- Technical architecture details
- Troubleshooting guide (detailed)
- Performance metrics
- Advanced usage patterns
- Distribution instructions
- Changelog

#### BUILD_QUICKSTART.md (Quick Reference)
- 3-step build process
- Essential commands
- Quick troubleshooting
- Basic distribution
- Minimum requirements

#### BUILD_SUMMARY.md (Technical Overview)
- What was created
- All files with details
- Key features
- Technical specifications
- Performance benchmarks
- Future enhancements
- Version history

## Generated Directories

### During Build

| Directory | Purpose | Size | Created By |
|-----------|---------|------|------------|
| `models/nanoLLaVA/` | Downloaded model files | ~500MB-1GB | `download_model.py` |
| `build/` | PyInstaller build cache | ~200MB | `build_server.py` |
| `dist/fastvlm-server/` | Final executable bundle | ~1-1.5GB | `build_server.py` |

### Directory Structure

```
python/
├── Core Scripts (5 files)
│   ├── download_model.py           # Downloads model
│   ├── build_server.py             # Builds executable
│   ├── verify_build_setup.py       # Verifies setup
│   ├── example_build_workflow.sh   # Automated workflow
│   └── fastvlm.spec                # PyInstaller config
│
├── Documentation (5 files)
│   ├── BUILD_SYSTEM.md             # Main guide
│   ├── BUILD_README.md             # Detailed docs
│   ├── BUILD_QUICKSTART.md         # Quick reference
│   ├── BUILD_SUMMARY.md            # System overview
│   └── BUILD_INDEX.md              # This file
│
├── Source Files (updated)
│   ├── inference.py                # Updated with model paths
│   ├── server.py                   # Unchanged
│   ├── requirements.txt            # Added build deps
│   └── .gitignore                  # Added build artifacts
│
└── Generated (during build)
    ├── models/
    │   └── nanoLLaVA/              # Downloaded model
    ├── build/                      # Build cache
    └── dist/
        └── fastvlm-server/         # Executable bundle
            ├── fastvlm-server      # Main executable
            ├── models/             # Bundled model
            └── _internal/          # Dependencies
```

## Workflow Guide

### First Time Setup

```mermaid
1. Read BUILD_SYSTEM.md
   ↓
2. Run verify_build_setup.py
   ↓
3. Install dependencies (requirements.txt)
   ↓
4. Download model (download_model.py)
   ↓
5. Build executable (build_server.py)
   ↓
6. Test the build
   ↓
7. Distribute
```

### Quick Command Reference

```bash
# Verify everything is ready
python verify_build_setup.py

# Automated build (recommended for first time)
./example_build_workflow.sh

# Manual build
python download_model.py              # Step 1: Download model
python build_server.py                # Step 2: Build

# Run the executable
./dist/fastvlm-server/fastvlm-server

# Test the server
curl http://localhost:5123/health

# Create distribution
cd dist && zip -r fastvlm-server.zip fastvlm-server/
```

## File Purpose Quick Reference

### When to Use Each File

| Task | Use This File | Command |
|------|---------------|---------|
| First time setup | `verify_build_setup.py` | `python verify_build_setup.py` |
| Automated build | `example_build_workflow.sh` | `./example_build_workflow.sh` |
| Download model | `download_model.py` | `python download_model.py` |
| Build executable | `build_server.py` | `python build_server.py` |
| Learn the system | `BUILD_SYSTEM.md` | Read the file |
| Quick reference | `BUILD_QUICKSTART.md` | Read the file |
| Detailed guide | `BUILD_README.md` | Read the file |
| Technical details | `BUILD_SUMMARY.md` | Read the file |
| Find files | `BUILD_INDEX.md` | This file |
| Troubleshooting | `BUILD_README.md` | See troubleshooting section |

## Reading Order

### For First-Time Users

1. **`BUILD_SYSTEM.md`** - Start here for overview
2. **`verify_build_setup.py`** - Check your setup
3. **`BUILD_QUICKSTART.md`** - Quick build steps
4. **`example_build_workflow.sh`** - Run automated build
5. **`BUILD_README.md`** - Read for details if needed

### For Technical Users

1. **`BUILD_SUMMARY.md`** - Technical overview
2. **`fastvlm.spec`** - Review PyInstaller config
3. **`build_server.py`** - Understand build process
4. **`inference.py`** - Review model loading logic
5. **`BUILD_README.md`** - Advanced usage patterns

### For Quick Users

1. **`BUILD_QUICKSTART.md`** - Read this only
2. **Run**: `./example_build_workflow.sh`
3. Done!

## File Dependencies

### Build Dependencies

```
requirements.txt
    ↓
download_model.py → models/nanoLLaVA/
    ↓
build_server.py + fastvlm.spec → dist/fastvlm-server/
    ↓
(executable ready)
```

### Documentation Dependencies

```
BUILD_INDEX.md (navigation)
    ↓
BUILD_SYSTEM.md (overview)
    ↓
├─ BUILD_QUICKSTART.md (quick start)
├─ BUILD_README.md (detailed guide)
└─ BUILD_SUMMARY.md (technical details)
```

## Key Changes to Existing Files

### inference.py
- Added `get_model_path()` function
- Supports bundled, local, and HuggingFace model loading
- Works in both development and production modes

### requirements.txt
- Added `pyinstaller>=6.0.0`
- Added `huggingface_hub>=0.20.0`

### .gitignore
- Added `build/` and `dist/` directories
- Added `models/` directory

## Version Information

- **Version**: 1.0.0
- **Created**: 2026-01-11
- **Platform**: macOS arm64 (Apple Silicon)
- **Python**: 3.8+
- **Build Tool**: PyInstaller 6.0+

## Support Matrix

| Component | Version | Required For |
|-----------|---------|--------------|
| Python | 3.8+ | Building |
| PyInstaller | 6.0+ | Building |
| MLX-VLM | 0.0.9+ | Building & Runtime |
| macOS | 13+ | Runtime |
| Architecture | arm64 | Runtime (recommended) |

## Quick Links

### Internal Documentation
- [Build System Overview](BUILD_SYSTEM.md)
- [Quick Start Guide](BUILD_QUICKSTART.md)
- [Detailed Documentation](BUILD_README.md)
- [Technical Summary](BUILD_SUMMARY.md)
- [File Index](BUILD_INDEX.md)

### External Resources
- [PyInstaller Documentation](https://pyinstaller.org/)
- [MLX-VLM GitHub](https://github.com/Blaizzy/mlx-vlm)
- [nanoLLaVA Model](https://huggingface.co/qnguyen3/nanoLLaVA)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)

## Summary Statistics

### Created Files
- **Core Scripts**: 5 files (~33KB)
- **Documentation**: 5 files (~44KB)
- **Total New Files**: 10 files

### Updated Files
- **Source Files**: 2 files (inference.py, requirements.txt)
- **Config Files**: 1 file (.gitignore)
- **Total Updated**: 3 files

### Build Output
- **Model Download**: ~500MB-1GB
- **Build Artifacts**: ~200MB
- **Final Executable**: ~1-1.5GB

---

**Navigation**: You are here → BUILD_INDEX.md

**Next Steps**: Read [BUILD_SYSTEM.md](BUILD_SYSTEM.md) to get started!
