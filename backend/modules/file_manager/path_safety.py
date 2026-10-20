"""Path containment checks for the file manager sandbox."""
from __future__ import annotations

import os
from typing import Iterable


def path_is_within(child: str, parent: str) -> bool:
    """True when ``child`` resolves under ``parent`` (symlink-safe)."""
    child_real = os.path.realpath(child)
    parent_real = os.path.realpath(parent)
    if child_real == parent_real:
        return True
    try:
        return os.path.commonpath([child_real, parent_real]) == parent_real
    except ValueError:
        # Different drive letters on Windows.
        return False


def resolve_allowed_path(requested_path: str, permitted_roots: Iterable[str]) -> str:
    """Resolve ``requested_path`` if it lies inside any permitted root."""
    abs_requested = os.path.realpath(os.path.abspath(requested_path))
    for root in permitted_roots:
        if not root:
            continue
        abs_root = os.path.realpath(os.path.abspath(root))
        if path_is_within(abs_requested, abs_root):
            return abs_requested
    raise PermissionError(abs_requested)
