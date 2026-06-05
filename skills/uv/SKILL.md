---
name: uv
description: "Use `uv` instead of pip/python/venv. Run scripts with `uv run script.py`, add deps with `uv add`, use inline script metadata for standalone scripts."
---

## Quick Reference

```bash
uv run script.py                   # Run a script
uv run --with requests script.py   # Run with ad-hoc dependency
uv run python -m ast foo.py >/dev/null  # Verify syntax without writing __pycache__
uv add requests                    # Add dependency to project
uv init --script foo.py            # Create script with inline metadata
```

## Running Scripts

### Basic Usage

```bash
uv run script.py                   # Run a script
uv run script.py arg1 arg2         # With arguments
uv run --python 3.10 script.py     # Specific Python version
echo 'print("hi")' | uv run -      # From stdin
```

In a project directory, use `--no-project` to skip installing the project:

```bash
uv run --no-project script.py
```

### Syntax Verification (No `__pycache__`)

Use the AST parser instead of `python -m py_compile`:

```bash
uv run python -m ast script.py >/dev/null
```

### Ad-hoc Dependencies

```bash
uv run --with requests script.py
uv run --with 'requests>2,<3' script.py
uv run --with requests --with rich script.py
```

## Inline Script Metadata (Recommended)

Declare dependencies directly in the script:

```python
# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "requests<3",
#   "rich",
# ]
# ///

import requests
from rich import print
```

Then just: `uv run script.py`

### Managing Script Dependencies

```bash
uv init --script example.py --python 3.12   # Create script with metadata
uv add --script example.py requests rich    # Add dependencies
```

### Alternative Index

```bash
uv add --index "https://example.com/simple" --script example.py requests
```

Adds to metadata:

```python
# [[tool.uv.index]]
# url = "https://example.com/simple"
```

### Locking Dependencies

```bash
uv lock --script example.py  # Creates example.py.lock
```

### Reproducibility

Pin resolution date:

```python
# /// script
# dependencies = ["requests"]
# [tool.uv]
# exclude-newer = "2023-10-16T00:00:00Z"
# ///
```

### Executable Scripts (Shebang)

```python
#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["httpx"]
# ///

import httpx
print(httpx.get("https://example.com"))
```

```bash
chmod +x myscript
./myscript
```

## Project Management

### Initialize a Project

```bash
uv init my-package                 # Create new package
uv init --lib my-package           # Create library (default)
uv init --app my-app               # Create application
cd my-package
```

### Add/Remove Dependencies

```bash
uv add requests                    # Add runtime dependency
uv add --dev pytest                # Add dev dependency
uv remove requests                 # Remove dependency
uv add 'requests<3'                # Add with version constraint
```

### Run Commands in Project Environment

```bash
uv run python myscript.py          # Run with project deps
uv run pytest                      # Run tests
uv run --no-project script.py      # Skip project install
```

### Sync Environment

```bash
uv sync                            # Sync environment with lockfile
uv sync --frozen                   # Fail if lockfile needs update
```

## Build Backend

Use `uv_build` for pure Python packages. For extension modules, use `hatchling` instead.

### pyproject.toml

```toml
[project]
name = "my-package"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = []

[build-system]
requires = ["uv_build>=0.9.28,<0.10.0"]
build-backend = "uv_build"
```

### Project Structure

Default layout uses `src/<package_name>/__init__.py`:

```
pyproject.toml
src/
└── my_package/
    └── __init__.py
```

Package name is normalized: `Foo-Bar` → `foo_bar`.

### Custom Module Location

```toml
[tool.uv.build-backend]
module-name = "mymodule"
module-root = ""  # Use project root instead of src/
```

### Namespace Packages

For `foo.bar` namespace:

```
src/foo/bar/__init__.py  # No __init__.py in foo/
```

```toml
[tool.uv.build-backend]
module-name = "foo.bar"
```

### File Inclusion/Exclusion

Excludes `__pycache__`, `*.pyc`, `*.pyo` by default.

```toml
[tool.uv.build-backend]
source-include = ["assets/**"]
source-exclude = ["/dist", "tests/**"]
```

- Includes are anchored (`pyproject.toml` = only root)
- Excludes are not anchored (`__pycache__` = all dirs named that)
- Use `/prefix` to anchor excludes

## Building and Publishing

```bash
uv build                           # Build package (sdist + wheel)
uv publish                         # Upload to PyPI
uv publish --token pypi-xxx        # With API token
```

## Python Version Management

```bash
uv python install 3.12             # Install Python version
uv python list                     # List available versions
uv python pin 3.12                 # Pin project to version
```

## Key Principles

1. **Always use `uv run`** instead of `python` for running scripts
2. **Prefer inline script metadata** for standalone scripts over requirements.txt
3. **Use `uv add`** instead of `pip install` for managing dependencies
4. **Use `uv_build`** for pure Python packages
5. **Lock dependencies** for reproducibility when needed
6. **No `__pycache__`** - use `uv run python -m ast` for syntax checks
