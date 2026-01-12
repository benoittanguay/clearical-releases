"""
PyInstaller hook for mlx_lm package.

This hook ensures that all mlx_lm submodules, especially model implementations,
are properly bundled with the executable. Without this hook, mlx_lm's dynamic
model loading fails at runtime because the model implementation modules are missing.
"""

from PyInstaller.utils.hooks import collect_all

# Collect everything from mlx_lm: modules, data files, binaries
datas, binaries, hiddenimports = collect_all('mlx_lm')

# Ensure all model implementations are included explicitly
# This is critical because mlx_lm dynamically imports models based on config
hiddenimports += [
    'mlx_lm.models.qwen2',  # Required for Qwen2.5-0.5B-Instruct-4bit
    'mlx_lm.models.base',
    'mlx_lm.models.cache',
    'mlx_lm.utils',
    'mlx_lm.tokenizer_utils',
    'mlx_lm.tuner.utils',
    'mlx_lm.sample_utils',
]
