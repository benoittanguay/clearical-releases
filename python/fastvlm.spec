# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller Spec File for FastVLM Server

This spec file configures PyInstaller to create a standalone macOS executable
that bundles the FastVLM server with all dependencies and the nanoLLaVA model.

Build command:
    pyinstaller python/fastvlm.spec

Output:
    python/dist/fastvlm-server/ - Standalone executable bundle
"""

import os
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

# Get the directory containing this spec file
spec_dir = Path(SPECPATH)

# Model directory (relative to spec file)
model_dir = spec_dir / "models" / "nanoLLaVA"

# Verify model exists
if not model_dir.exists():
    print("=" * 60)
    print("ERROR: Model directory not found!")
    print(f"Expected location: {model_dir}")
    print("\nPlease run the download script first:")
    print("  python python/download_model.py")
    print("=" * 60)
    sys.exit(1)

print(f"Building with model from: {model_dir}")

# Collect all model files
model_data = []
for item in model_dir.rglob("*"):
    if item.is_file():
        # Get relative path from model_dir
        rel_path = item.relative_to(model_dir.parent)
        # Add to data files (source, destination)
        model_data.append((str(item), str(rel_path.parent)))
        print(f"  Including: {rel_path}")

print(f"Total model files: {len(model_data)}")

# Collect mlx and mlx-vlm data files
mlx_data = collect_data_files('mlx')
mlx_vlm_data = collect_data_files('mlx_vlm')

# Collect all submodules for critical packages
hiddenimports = []
hiddenimports += collect_submodules('mlx')
hiddenimports += collect_submodules('mlx_vlm')
hiddenimports += collect_submodules('fastapi')
hiddenimports += collect_submodules('uvicorn')
hiddenimports += collect_submodules('pydantic')
hiddenimports += collect_submodules('PIL')
hiddenimports += collect_submodules('numpy')
hiddenimports += collect_submodules('transformers')
hiddenimports += collect_submodules('huggingface_hub')

# Add specific hidden imports that PyInstaller might miss
hiddenimports += [
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'pydantic.deprecated.decorator',
    'pydantic.json_schema',
    'pydantic_core',
]

# Analysis step - scan all Python dependencies
a = Analysis(
    ['server.py'],  # Main script
    pathex=[str(spec_dir)],  # Additional paths to search
    binaries=[],
    datas=model_data + mlx_data + mlx_vlm_data,  # Include model and library data
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude unnecessary packages to reduce size
        'matplotlib',
        'scipy',
        'pandas',
        'torch',
        'tensorflow',
        'jax',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=None,
    noarchive=False,
)

# Create PYZ archive (compressed Python bytecode)
pyz = PYZ(
    a.pure,
    a.zipped_data,
    cipher=None,
)

# Create the executable
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,  # Don't bundle binaries in exe (use folder distribution)
    name='fastvlm-server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,  # Don't strip symbols (needed for debugging if issues occur)
    upx=False,  # Don't use UPX compression (can cause issues with MLX)
    console=True,  # Keep console window for logs
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch='arm64',  # Target Apple Silicon
    codesign_identity=None,
    entitlements_file=None,
)

# Create COLLECT to bundle everything into a folder
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='fastvlm-server',
)
