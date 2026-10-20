"""Shared no-AVX frontend build tuning (install.sh + AppStore rebuild)."""
from __future__ import annotations


def read_mem_total_mb() -> int | None:
    try:
        with open("/proc/meminfo", encoding="utf-8") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    kb = int(line.split()[1])
                    return kb // 1024
    except OSError:
        return None
    return None


def node_heap_mb_for_noavx(mem_total_mb: int | None = None) -> int:
    """Node --max-old-space-size for WASM Vite on CPUs without AVX (~40% RAM, capped)."""
    if mem_total_mb is None:
        mem_total_mb = read_mem_total_mb()
    if mem_total_mb is None or mem_total_mb <= 0:
        return 3072
    heap = (mem_total_mb * 2) // 5
    return max(1536, min(4096, heap))


_PIPE_MARKERS = (
    "too many writes on closed pipe",
    "os.sigpipe",
    "closed pipe",
    "sigpipe",
)


def is_wasm_render_failure(return_code: int, log_text: str) -> bool:
    """Detect esbuild-wasm / Node crashes during Vite's render-chunks phase."""
    if return_code in (139, -11, 245):
        return True
    blob = (log_text or "").lower()
    if "segmentation fault" in blob or "sigsegv" in blob:
        return True
    return any(m in blob for m in _PIPE_MARKERS)


def is_retriable_noavx_build_failure(return_code: int, log_text: str) -> bool:
    if return_code in (137, -9):
        return True
    blob = (log_text or "").lower()
    if "heap out of memory" in blob or "javascript heap" in blob:
        return True
    return is_wasm_render_failure(return_code, log_text)
