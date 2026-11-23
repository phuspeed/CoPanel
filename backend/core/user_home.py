"""Restricted-user home folders: make sure they exist and pick file ownership.

CoPanel runs as root, so the panel itself can always write inside a user's
``permitted_folders``. Two things still go wrong for restricted users:

* the panel never created the folder on disk (creating a panel user does not
  create ``/home/<name>``), so listing showed an empty folder and creating or
  uploading into it failed;
* files the panel created were owned by root, even when the folder belongs to
  a real system account of the same name.

This module creates missing permitted folders and, when a permitted folder is
owned by a non-root system account (e.g. ``useradd -m phutv``), gives newly
created items that owner. It never creates system users.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from core import safe_fs

logger = logging.getLogger(__name__)

HOME_MODE = 0o750


def permitted_folders(user: Dict[str, Any]) -> List[str]:
    raw = user.get("permitted_folders", "[]")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            raw = [raw]
    if not isinstance(raw, list):
        return []
    return [str(p).strip() for p in raw if isinstance(p, str) and str(p).strip()]


def _system_account(username: str) -> Optional[Tuple[int, int, str]]:
    try:
        import pwd  # POSIX only
    except ImportError:
        return None
    try:
        pw = pwd.getpwnam(username)
    except (KeyError, TypeError):
        return None
    return pw.pw_uid, pw.pw_gid, pw.pw_dir


def ensure_permitted_folders(user: Dict[str, Any]) -> List[str]:
    """Create any missing permitted folder of a non-superadmin user.

    A created folder is chowned to the system account with the same username
    only when that account's home directory is this folder. Returns the list of
    folders that were created. Errors are logged, never raised.
    """
    if not user or user.get("role") == "superadmin":
        return []
    created: List[str] = []
    for folder in permitted_folders(user):
        if not os.path.isabs(folder):
            continue
        try:
            if os.path.lexists(folder):
                continue
            made = safe_fs.makedirs(folder, None, mode=HOME_MODE)
            if not made:
                continue
            created.append(os.path.normpath(folder))
            acct = _system_account(str(user.get("username") or ""))
            if acct and os.path.abspath(acct[2]) == os.path.abspath(folder):
                try:
                    safe_fs.chown_tree(folder, (acct[0], acct[1]))
                except OSError as exc:
                    logger.warning("chown %s failed: %s", folder, exc)
        except OSError as exc:
            logger.warning("Could not create permitted folder %s: %s", folder, exc)
    return created


def owner_for(path: str, user: Dict[str, Any]) -> Optional[Tuple[int, int]]:
    """uid/gid new items under ``path`` should get, or None to leave as is.

    For a restricted user this is the owner of the permitted folder that
    contains ``path``, if that owner is not root. Superadmin: None.
    """
    if not user or user.get("role") == "superadmin" or not hasattr(os, "chown"):
        return None
    try:
        target = Path(path).resolve()
    except (OSError, RuntimeError, ValueError):
        return None
    for folder in permitted_folders(user):
        try:
            root = Path(folder).resolve()
            if target == root or target.is_relative_to(root):
                st = root.stat()
                if st.st_uid == 0:
                    return None
                return st.st_uid, st.st_gid
        except (OSError, RuntimeError, ValueError):
            continue
    return None


def is_restricted(user: Optional[Dict[str, Any]]) -> bool:
    return bool(user) and user.get("role") != "superadmin"


def chown_new(paths: List[str], user: Dict[str, Any], recursive: bool = False) -> None:
    """Give ``paths`` (just created by the panel) the restricted user's owner.

    Ownership is applied with ``fchownat(AT_SYMLINK_NOFOLLOW)`` relative to a
    parent directory reached without following symlinks (see ``safe_fs``), so a
    parent swapped for a symlink makes the call fail instead of chowning a
    file elsewhere. Only root-owned items with a single hard link change owner.
    """
    for p in paths:
        owner = owner_for(p, user)
        if not owner:
            continue
        try:
            safe_fs.chown_tree(p, owner, recursive=recursive)
        except OSError as exc:
            logger.warning("chown %s failed: %s", p, exc)
