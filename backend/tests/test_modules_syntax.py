"""Ensure every module logic/router file compiles and imports (no SyntaxError regressions)."""
from __future__ import annotations

import importlib
import py_compile
import sqlite3
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
MODULES_DIR = BACKEND_DIR / "modules"


def _module_py_files() -> list[Path]:
    paths: list[Path] = []
    for name in ("logic.py", "router.py"):
        paths.extend(sorted(MODULES_DIR.glob(f"*/{name}")))
    return paths


@pytest.fixture
def _skip_opt_copanel_mkdir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Some modules init SQLite under /opt/copanel at import time (not present in dev CI)."""
    original_mkdir = Path.mkdir
    opt_root = tmp_path / "opt_copanel"
    opt_root.mkdir(parents=True, exist_ok=True)

    def mkdir(self: Path, *args, **kwargs):
        if str(self).startswith("/opt/copanel"):
            target = opt_root / str(self).removeprefix("/opt/copanel/").lstrip("/")
            return original_mkdir(target, *args, **kwargs)
        return original_mkdir(self, *args, **kwargs)

    real_connect = sqlite3.connect

    def connect(database, *args, **kwargs):
        db_str = str(database)
        if db_str.startswith("/opt/copanel"):
            mapped = opt_root / db_str.removeprefix("/opt/copanel/").lstrip("/")
            mapped.parent.mkdir(parents=True, exist_ok=True)
            return real_connect(str(mapped), *args, **kwargs)
        return real_connect(database, *args, **kwargs)

    monkeypatch.setattr(Path, "mkdir", mkdir)
    monkeypatch.setattr(sqlite3, "connect", connect)


@pytest.mark.parametrize("path", _module_py_files(), ids=lambda p: p.relative_to(BACKEND_DIR).as_posix())
def test_module_file_py_compiles(path: Path) -> None:
    py_compile.compile(str(path), doraise=True)


@pytest.mark.parametrize("path", _module_py_files(), ids=lambda p: p.relative_to(BACKEND_DIR).as_posix())
def test_module_file_imports(path: Path, _skip_opt_copanel_mkdir: None) -> None:
    rel = path.relative_to(BACKEND_DIR)
    module_name = ".".join(rel.with_suffix("").parts)
    if module_name in sys.modules:
        importlib.reload(sys.modules[module_name])
    else:
        importlib.import_module(module_name)
