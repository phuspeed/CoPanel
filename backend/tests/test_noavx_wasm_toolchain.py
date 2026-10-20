"""WASM toolchain swap (no native @esbuild / rollup-linux-*)."""
import json
import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
WASM_SCRIPT = ROOT / "frontend" / "scripts" / "wasm-toolchain.mjs"


def _fixture_tree(tmp_path: Path) -> Path:
    nm = tmp_path / "node_modules"
    for rel in (
        "esbuild/package.json",
        "esbuild-wasm/package.json",
        "esbuild-wasm/esbuild.wasm",
        "@esbuild/linux-x64/package.json",
        "rollup/package.json",
        "@rollup/wasm-node/package.json",
        "@rollup/rollup-linux-x64-gnu/package.json",
        "vite/node_modules/esbuild/package.json",
        "vite/node_modules/rollup/package.json",
    ):
        p = nm / rel
        p.parent.mkdir(parents=True, exist_ok=True)
    (nm / "esbuild" / "package.json").write_text(
        json.dumps({"name": "esbuild", "version": "0.21.5"}), encoding="utf-8"
    )
    (nm / "esbuild-wasm" / "package.json").write_text(
        json.dumps({"name": "esbuild-wasm", "version": "0.21.5", "main": "lib/main.js"}),
        encoding="utf-8",
    )
    (nm / "esbuild-wasm" / "esbuild.wasm").write_text("wasm", encoding="utf-8")
    (nm / "@esbuild" / "linux-x64" / "package.json").write_text(
        json.dumps({"name": "@esbuild/linux-x64"}), encoding="utf-8"
    )
    (nm / "rollup" / "package.json").write_text(
        json.dumps({"name": "rollup", "version": "4.60.2"}), encoding="utf-8"
    )
    (nm / "@rollup" / "wasm-node" / "package.json").write_text(
        json.dumps({"name": "@rollup/wasm-node", "version": "4.60.2"}), encoding="utf-8"
    )
    (nm / "@rollup" / "rollup-linux-x64-gnu" / "package.json").write_text(
        json.dumps({"name": "@rollup/rollup-linux-x64-gnu"}), encoding="utf-8"
    )
    (nm / "vite" / "node_modules" / "esbuild" / "package.json").write_text(
        json.dumps({"name": "esbuild"}), encoding="utf-8"
    )
    (nm / "vite" / "node_modules" / "rollup" / "package.json").write_text(
        json.dumps({"name": "rollup"}), encoding="utf-8"
    )
    (tmp_path / "package.json").write_text(json.dumps({"name": "fixture", "private": True}), encoding="utf-8")
    return tmp_path


@pytest.mark.skipif(not WASM_SCRIPT.is_file(), reason="wasm-toolchain.mjs missing")
def test_wasm_toolchain_install_removes_native_bins(tmp_path):
    work = _fixture_tree(tmp_path)
    proc = subprocess.run(
        ["node", str(WASM_SCRIPT), "install"],
        cwd=str(work),
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert proc.returncode == 0, proc.stderr or proc.stdout
    assert "esbuild-wasm" in proc.stdout
    assert "@rollup/wasm-node" in proc.stdout
    assert not (work / "node_modules" / "@esbuild").exists()
    assert not (work / "node_modules" / "@rollup" / "rollup-linux-x64-gnu").exists()
    nested_es = json.loads(
        (work / "node_modules" / "vite" / "node_modules" / "esbuild" / "package.json").read_text()
    )
    assert nested_es["name"] == "esbuild-wasm"


def test_cpu_lacks_avx_force_flag():
    from modules.appstore_manager.logic import _cpu_lacks_avx

    prev = os.environ.get("COPANEL_FORCE_NO_AVX")
    os.environ["COPANEL_FORCE_NO_AVX"] = "1"
    try:
        assert _cpu_lacks_avx() is True
    finally:
        if prev is None:
            os.environ.pop("COPANEL_FORCE_NO_AVX", None)
        else:
            os.environ["COPANEL_FORCE_NO_AVX"] = prev
