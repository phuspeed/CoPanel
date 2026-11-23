"""Symlink-safe file operations for sandboxed (restricted) panel users.

CoPanel runs as root. For a restricted user, ``check_safe_path`` validates a
path once, but a local account that owns the folder could swap a directory
for a symlink between that check and the actual operation (TOCTOU), making
root read, write, delete or chown something outside the sandbox.

Every helper here reaches its target by walking from ``/`` one component at a
time with ``O_NOFOLLOW`` and then works relative to the pinned parent
directory fd (``openat``/``unlinkat``/``renameat``/``fchownat`` style calls).
A symlink anywhere in the path at operation time makes the call fail with
``SymlinkRefused`` instead of being followed.

Rules:
* symlinks are never followed; a copy reproduces a symlink as a symlink;
* regular files with more than one hard link are not written, chowned or
  copied (hard link tricks against root-owned files);
* new items get their owner via ``fchown``/``fchownat`` on the pinned fd,
  never through a path string.
"""
from __future__ import annotations

import errno
import os
import shutil
import stat
from contextlib import contextmanager
from typing import Iterator, List, Optional, Tuple

Owner = Optional[Tuple[int, int]]

_CLOEXEC = getattr(os, "O_CLOEXEC", 0)
_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
_DIRECTORY = getattr(os, "O_DIRECTORY", 0)
_NONBLOCK = getattr(os, "O_NONBLOCK", 0)
DIR_FLAGS = os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC
_CHUNK = 1024 * 1024


class SymlinkRefused(OSError):
    """A path component was a symlink (or not what the caller expected)."""

    def __init__(self, path: str, reason: str = "symlink in path"):
        super().__init__(errno.ELOOP, f"Refused: {reason}: {path}")
        self.path = path


def supported() -> bool:
    return bool(_NOFOLLOW and _DIRECTORY) and os.open in os.supports_dir_fd


def _components(path: str) -> List[str]:
    norm = os.path.normpath(os.path.abspath(path))
    return [c for c in norm.split(os.sep) if c]


def open_dir(path: str) -> int:
    """Open directory ``path`` without following any symlink on the way."""
    fd = os.open("/", DIR_FLAGS)
    try:
        for comp in _components(path):
            try:
                nfd = os.open(comp, DIR_FLAGS, dir_fd=fd)
            except OSError as exc:
                if exc.errno in (errno.ELOOP, errno.ENOTDIR):
                    raise SymlinkRefused(path) from exc
                raise
            os.close(fd)
            fd = nfd
        return fd
    except BaseException:
        os.close(fd)
        raise


def split(path: str) -> Tuple[str, str]:
    norm = os.path.normpath(os.path.abspath(path))
    parent, name = os.path.split(norm)
    if not name or name in (".", ".."):
        raise SymlinkRefused(path, "invalid final component")
    return parent, name


@contextmanager
def parent_of(path: str) -> Iterator[Tuple[int, str]]:
    parent, name = split(path)
    fd = open_dir(parent)
    try:
        yield fd, name
    finally:
        os.close(fd)


@contextmanager
def dir_fd(path: str) -> Iterator[int]:
    fd = open_dir(path)
    try:
        yield fd
    finally:
        os.close(fd)


def lstat(path: str) -> Optional[os.stat_result]:
    """``lstat`` relative to a pinned parent; None when missing."""
    try:
        with parent_of(path) as (pfd, name):
            return os.stat(name, dir_fd=pfd, follow_symlinks=False)
    except FileNotFoundError:
        return None


def exists(path: str) -> bool:
    return lstat(path) is not None


def _apply_owner_fd(fd: int, owner: Owner) -> None:
    if owner and hasattr(os, "fchown"):
        os.fchown(fd, owner[0], owner[1])


def chown_at(pfd: int, name: str, owner: Owner) -> bool:
    """Give ``name`` (in pinned dir ``pfd``) ``owner`` without following links.

    Only items still owned by root (i.e. just created by the panel) are
    changed, and never a regular file with extra hard links.
    """
    if not owner:
        return False
    st = os.stat(name, dir_fd=pfd, follow_symlinks=False)
    if st.st_uid != 0 and hasattr(os, "geteuid") and os.geteuid() == 0:
        return False
    if stat.S_ISREG(st.st_mode) and st.st_nlink > 1:
        return False
    os.chown(name, owner[0], owner[1], dir_fd=pfd, follow_symlinks=False)
    return True


def chown_tree(path: str, owner: Owner, recursive: bool = False) -> None:
    if not owner:
        return
    with parent_of(path) as (pfd, name):
        chown_at(pfd, name, owner)
        st = os.stat(name, dir_fd=pfd, follow_symlinks=False)
        if not recursive or not stat.S_ISDIR(st.st_mode):
            return
        for _root, dirs, files, rfd in os.fwalk(name, dir_fd=pfd, follow_symlinks=False):
            for entry in dirs + files:
                try:
                    chown_at(rfd, entry, owner)
                except FileNotFoundError:
                    continue


def open_read(path: str) -> int:
    """Open a regular file for reading; refuses symlinks and special files."""
    with parent_of(path) as (pfd, name):
        try:
            fd = os.open(name, os.O_RDONLY | _NOFOLLOW | _NONBLOCK | _CLOEXEC, dir_fd=pfd)
        except OSError as exc:
            if exc.errno == errno.ELOOP:
                raise SymlinkRefused(path) from exc
            raise
    st = os.fstat(fd)
    if not stat.S_ISREG(st.st_mode):
        os.close(fd)
        raise IsADirectoryError(errno.EISDIR, "Not a regular file", path)
    os.set_blocking(fd, True)
    return fd


def read_bytes(path: str) -> bytes:
    fd = open_read(path)
    with os.fdopen(fd, "rb") as fh:
        return fh.read()


def open_write(path: str, owner: Owner = None, *, exclusive: bool = False, mode: int = 0o644) -> int:
    """Create or truncate a regular file; new files get ``owner`` via fchown."""
    with parent_of(path) as (pfd, name):
        base = os.O_WRONLY | _NOFOLLOW | _NONBLOCK | _CLOEXEC
        created = False
        try:
            fd = os.open(name, base | os.O_CREAT | os.O_EXCL, mode, dir_fd=pfd)
            created = True
        except FileExistsError:
            if exclusive:
                raise
            try:
                fd = os.open(name, base, dir_fd=pfd)
            except OSError as exc:
                if exc.errno == errno.ELOOP:
                    raise SymlinkRefused(path) from exc
                raise
        except OSError as exc:
            if exc.errno == errno.ELOOP:
                raise SymlinkRefused(path) from exc
            raise
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise IsADirectoryError(errno.EISDIR, "Not a regular file", path)
        if st.st_nlink > 1:
            raise SymlinkRefused(path, "file has multiple hard links")
        if not created:
            os.ftruncate(fd, 0)
        os.set_blocking(fd, True)
        if created:
            _apply_owner_fd(fd, owner)
        return fd
    except BaseException:
        os.close(fd)
        raise


def write_bytes(path: str, data: bytes, owner: Owner = None, *, exclusive: bool = False) -> None:
    fd = open_write(path, owner, exclusive=exclusive)
    with os.fdopen(fd, "wb") as fh:
        fh.write(data)


def write_stream(path: str, src, owner: Owner = None) -> None:
    fd = open_write(path, owner)
    with os.fdopen(fd, "wb") as fh:
        shutil.copyfileobj(src, fh, _CHUNK)


def mkdir(path: str, owner: Owner = None, mode: int = 0o755) -> None:
    with parent_of(path) as (pfd, name):
        os.mkdir(name, mode, dir_fd=pfd)
        if owner:
            chown_at(pfd, name, owner)


def makedirs(path: str, owner: Owner = None, mode: int = 0o755) -> List[str]:
    """``mkdir -p`` without following symlinks; returns created paths."""
    created: List[str] = []
    fd = os.open("/", DIR_FLAGS)
    current = "/"
    try:
        for comp in _components(path):
            current = os.path.join(current, comp)
            try:
                os.mkdir(comp, mode, dir_fd=fd)
                created.append(current)
                if owner:
                    chown_at(fd, comp, owner)
            except FileExistsError:
                pass
            try:
                nfd = os.open(comp, DIR_FLAGS, dir_fd=fd)
            except OSError as exc:
                if exc.errno in (errno.ELOOP, errno.ENOTDIR):
                    raise SymlinkRefused(path) from exc
                raise
            os.close(fd)
            fd = nfd
    finally:
        os.close(fd)
    return created


def remove(path: str) -> None:
    """Delete a file, symlink (the link itself) or directory tree."""
    with parent_of(path) as (pfd, name):
        st = os.stat(name, dir_fd=pfd, follow_symlinks=False)
        if stat.S_ISDIR(st.st_mode):
            shutil.rmtree(name, dir_fd=pfd)
        else:
            os.unlink(name, dir_fd=pfd)


def rename(src: str, dst: str, *, overwrite: bool = False) -> None:
    with parent_of(src) as (sfd, sname), parent_of(dst) as (dfd, dname):
        os.stat(sname, dir_fd=sfd, follow_symlinks=False)
        if not overwrite:
            try:
                os.stat(dname, dir_fd=dfd, follow_symlinks=False)
                raise FileExistsError(errno.EEXIST, "Destination exists", dst)
            except FileNotFoundError:
                pass
        os.rename(sname, dname, src_dir_fd=sfd, dst_dir_fd=dfd)


def chmod(path: str, mode: int) -> None:
    """chmod through an O_NOFOLLOW fd (Linux has no lchmod)."""
    with parent_of(path) as (pfd, name):
        st = os.stat(name, dir_fd=pfd, follow_symlinks=False)
        if stat.S_ISLNK(st.st_mode):
            raise SymlinkRefused(path)
        if not (stat.S_ISREG(st.st_mode) or stat.S_ISDIR(st.st_mode)):
            raise SymlinkRefused(path, "not a regular file or directory")
        flags = os.O_RDONLY | _NOFOLLOW | _NONBLOCK | _CLOEXEC
        if stat.S_ISDIR(st.st_mode):
            flags |= _DIRECTORY
        fd = os.open(name, flags, dir_fd=pfd)
    try:
        os.fchmod(fd, mode)
    finally:
        os.close(fd)


def _copy_file_at(sfd: int, sname: str, dfd: int, dname: str, owner: Owner) -> None:
    src = os.open(sname, os.O_RDONLY | _NOFOLLOW | _NONBLOCK | _CLOEXEC, dir_fd=sfd)
    try:
        st = os.fstat(src)
        if not stat.S_ISREG(st.st_mode):
            return
        os.set_blocking(src, True)
        dst = os.open(
            dname,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | _NOFOLLOW | _CLOEXEC,
            stat.S_IMODE(st.st_mode) & 0o777,
            dir_fd=dfd,
        )
        try:
            _apply_owner_fd(dst, owner)
            while True:
                buf = os.read(src, _CHUNK)
                if not buf:
                    break
                view = memoryview(buf)
                while view:
                    n = os.write(dst, view)
                    view = view[n:]
            try:
                os.utime(dst, ns=(st.st_atime_ns, st.st_mtime_ns))
            except OSError:
                pass
        finally:
            os.close(dst)
    finally:
        os.close(src)


def _copy_tree_at(sfd: int, dfd: int, owner: Owner, depth: int = 0) -> None:
    if depth > 256:
        raise OSError(errno.ELOOP, "Directory tree too deep")
    for entry in os.scandir(sfd):
        name = entry.name
        st = os.stat(name, dir_fd=sfd, follow_symlinks=False)
        if stat.S_ISLNK(st.st_mode):
            target = os.readlink(name, dir_fd=sfd)
            os.symlink(target, name, dir_fd=dfd)
            if owner:
                os.chown(name, owner[0], owner[1], dir_fd=dfd, follow_symlinks=False)
        elif stat.S_ISDIR(st.st_mode):
            try:
                child = os.open(name, DIR_FLAGS, dir_fd=sfd)
            except OSError as exc:
                if exc.errno in (errno.ELOOP, errno.ENOTDIR):
                    continue  # swapped for a symlink mid-copy: skip it
                raise
            try:
                os.mkdir(name, stat.S_IMODE(st.st_mode) & 0o777 or 0o755, dir_fd=dfd)
                if owner:
                    chown_at(dfd, name, owner)
                dchild = os.open(name, DIR_FLAGS, dir_fd=dfd)
                try:
                    _copy_tree_at(child, dchild, owner, depth + 1)
                finally:
                    os.close(dchild)
            finally:
                os.close(child)
        elif stat.S_ISREG(st.st_mode):
            try:
                _copy_file_at(sfd, name, dfd, name, owner)
            except OSError as exc:
                if exc.errno == errno.ELOOP:
                    continue
                raise
        # sockets, fifos, devices: skipped


def copy(src: str, dst: str, owner: Owner = None) -> None:
    """Copy a file or tree; symlinks are copied as links, never followed."""
    with parent_of(src) as (sfd, sname), parent_of(dst) as (dfd, dname):
        st = os.stat(sname, dir_fd=sfd, follow_symlinks=False)
        if stat.S_ISLNK(st.st_mode):
            os.symlink(os.readlink(sname, dir_fd=sfd), dname, dir_fd=dfd)
            if owner:
                os.chown(dname, owner[0], owner[1], dir_fd=dfd, follow_symlinks=False)
            return
        if stat.S_ISDIR(st.st_mode):
            child = os.open(sname, DIR_FLAGS, dir_fd=sfd)
            try:
                os.mkdir(dname, stat.S_IMODE(st.st_mode) & 0o777 or 0o755, dir_fd=dfd)
                if owner:
                    chown_at(dfd, dname, owner)
                dchild = os.open(dname, DIR_FLAGS, dir_fd=dfd)
                try:
                    _copy_tree_at(child, dchild, owner)
                finally:
                    os.close(dchild)
            finally:
                os.close(child)
            return
        if stat.S_ISREG(st.st_mode):
            _copy_file_at(sfd, sname, dfd, dname, owner)
            return
        raise SymlinkRefused(src, "not a regular file or directory")


def walk_files(path: str) -> Iterator[Tuple[str, int, str]]:
    """Yield (relative_path, dir_fd, name) for regular files under ``path``.

    ``dir_fd`` is only valid during the iteration step.
    """
    with parent_of(path) as (pfd, name):
        for root, _dirs, files, rfd in os.fwalk(name, dir_fd=pfd, follow_symlinks=False):
            for fname in files:
                try:
                    st = os.stat(fname, dir_fd=rfd, follow_symlinks=False)
                except FileNotFoundError:
                    continue
                if stat.S_ISREG(st.st_mode):
                    yield os.path.join(root, fname), rfd, fname


def open_read_at(dfd: int, name: str) -> int:
    fd = os.open(name, os.O_RDONLY | _NOFOLLOW | _NONBLOCK | _CLOEXEC, dir_fd=dfd)
    if not stat.S_ISREG(os.fstat(fd).st_mode):
        os.close(fd)
        raise SymlinkRefused(name, "not a regular file")
    os.set_blocking(fd, True)
    return fd
