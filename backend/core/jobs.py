"""
Job orchestration layer for CoPanel.

A simple, dependency-free async job system that all long-running module
tasks (backup, ssl issue, package install, docker build, deploys, ...) should
go through. The frontend Task Center subscribes to the ``jobs`` event topic
to render unified progress, retry, and history.

Key features:
    - In-memory queue + asyncio worker pool (per-process, plenty for a self-
      hosted panel; can be swapped for redis later without API changes).
    - Per-job log lines, percent progress, status, and result.
    - Cancellation via cooperative ``cancel`` flag.
    - SQLite persistence so jobs survive a restart and feed Task Center
      history.

Usage from a module router:

    from core.jobs import jobs

    async def _do_backup(job, profile_id):
        job.log(f"Starting backup of {profile_id}")
        for step in steps:
            job.update(progress=p, message="Compressing")
            ...
        return {"file": "/path"}

    @router.post("/start")
    async def start(profile_id: str):
        job = jobs.submit(
            kind="backup_manager.run",
            module="backup_manager",
            title=f"Backup {profile_id}",
            payload={"profile": profile_id},
            handler=_do_backup,
            args=(profile_id,),
        )
        return {"job_id": job.id}
"""
from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import time
import traceback
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional

from .events import bus
from .user_model import get_db_connection

logger = logging.getLogger(__name__)


JobHandler = Callable[..., Awaitable[Any]]


JOB_STATUS_QUEUED = "queued"
JOB_STATUS_RUNNING = "running"
JOB_STATUS_SUCCESS = "success"
JOB_STATUS_FAILED = "failed"
JOB_STATUS_CANCELLED = "cancelled"

_TERMINAL_STATUSES = {JOB_STATUS_SUCCESS, JOB_STATUS_FAILED, JOB_STATUS_CANCELLED}


@dataclass
class Job:
    id: str
    kind: str
    module: Optional[str]
    title: str
    payload: Dict[str, Any]
    actor: Optional[str] = None
    status: str = JOB_STATUS_QUEUED
    progress: int = 0
    message: str = ""
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=lambda: time.time())
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    logs: List[Dict[str, Any]] = field(default_factory=list)

    _cancel_flag: bool = False

    def cancel_requested(self) -> bool:
        return self._cancel_flag

    def request_cancel(self) -> None:
        self._cancel_flag = True

    def log(self, line: str, level: str = "info") -> None:
        entry = {"ts": int(time.time() * 1000), "level": level, "line": line}
        self.logs.append(entry)
        if len(self.logs) > 500:
            self.logs = self.logs[-500:]
        bus.publish_sync("jobs", {"event": "log", "job_id": self.id, "entry": entry})

    def update(self, *, progress: Optional[int] = None, message: Optional[str] = None) -> None:
        if progress is not None:
            self.progress = max(0, min(100, int(progress)))
        if message is not None:
            self.message = message
        bus.publish_sync(
            "jobs",
            {
                "event": "update",
                "job_id": self.id,
                "progress": self.progress,
                "message": self.message,
                "status": self.status,
            },
        )

    def to_dict(self, *, include_logs: bool = False) -> Dict[str, Any]:
        d = {
            "id": self.id,
            "kind": self.kind,
            "module": self.module,
            "title": self.title,
            "payload": self.payload,
            "actor": self.actor,
            "status": self.status,
            "progress": self.progress,
            "message": self.message,
            "result": self.result,
            "error": self.error,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }
        if include_logs:
            d["logs"] = list(self.logs)
        return d


class JobManager:
    def __init__(self, *, workers: int = 4) -> None:
        self._jobs: Dict[str, Job] = {}
        self._queue: "asyncio.Queue[tuple[Job, JobHandler, tuple, dict]]" = asyncio.Queue()
        self._handlers: Dict[str, JobHandler] = {}
        self._worker_count = workers
        self._workers: List[asyncio.Task] = []
        self._init_table()

    def _init_table(self) -> None:
        conn = get_db_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    module TEXT,
                    title TEXT NOT NULL,
                    actor TEXT,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL DEFAULT 0,
                    message TEXT,
                    payload TEXT,
                    result TEXT,
                    error TEXT,
                    created_at REAL NOT NULL,
                    started_at REAL,
                    finished_at REAL,
                    logs TEXT
                );
                """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_jobs_module ON jobs(module, created_at DESC);")
            conn.commit()
        finally:
            conn.close()

    def register(self, kind: str, handler: JobHandler) -> None:
        """Register a default handler for ``kind`` so it can be re-run by id."""
        self._handlers[kind] = handler

    async def start(self, app=None) -> None:
        if self._workers:
            return
        for i in range(self._worker_count):
            self._workers.append(asyncio.create_task(self._worker(i)))

    async def stop(self) -> None:
        for w in self._workers:
            w.cancel()
        self._workers.clear()

    def submit(
        self,
        *,
        kind: str,
        title: str,
        handler: Optional[JobHandler] = None,
        module: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
        actor: Optional[str] = None,
        args: tuple = (),
        kwargs: Optional[Dict[str, Any]] = None,
    ) -> Job:
        job = Job(
            id=str(uuid.uuid4()),
            kind=kind,
            module=module,
            title=title,
            payload=payload or {},
            actor=actor,
        )
        self._jobs[job.id] = job
        self._persist(job)
        chosen = handler or self._handlers.get(kind)
        if chosen is None:
            job.status = JOB_STATUS_FAILED
            job.error = f"No handler registered for kind '{kind}'."
            job.finished_at = time.time()
            self._persist(job)
            bus.publish_sync("jobs", {"event": "fail", "job": job.to_dict()})
            return job
        bus.publish_sync("jobs", {"event": "queued", "job": job.to_dict()})
        self._queue.put_nowait((job, chosen, tuple(args), dict(kwargs or {})))
        return job

    def get(self, job_id: str, *, include_logs: bool = False) -> Optional[Dict[str, Any]]:
        job = self._jobs.get(job_id)
        if job:
            return job.to_dict(include_logs=include_logs)
        return self._fetch_persisted(job_id, include_logs=include_logs)

    def list(self, *, limit: int = 50, module: Optional[str] = None) -> List[Dict[str, Any]]:
        conn = get_db_connection()
        try:
            cur = conn.cursor()
            if module:
                cur.execute(
                    "SELECT * FROM jobs WHERE module = ? ORDER BY created_at DESC LIMIT ?",
                    (module, int(limit)),
                )
            else:
                cur.execute(
                    "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?",
                    (int(limit),),
                )
            rows = cur.fetchall()
            out = []
            for r in rows:
                row = dict(r)
                for f in ("payload", "result", "logs"):
                    if row.get(f):
                        try:
                            row[f] = json.loads(row[f])
                        except json.JSONDecodeError:
                            pass
                out.append(row)
            return out
        finally:
            conn.close()

    def cancel(self, job_id: str) -> bool:
        job = self._jobs.get(job_id)
        if not job or job.status in _TERMINAL_STATUSES:
            return False
        job.request_cancel()
        return True

    async def _worker(self, idx: int) -> None:
        logger.info("Job worker %d started", idx)
        while True:
            try:
                job, handler, args, kwargs = await self._queue.get()
            except asyncio.CancelledError:
                return
            try:
                await self._run(job, handler, args, kwargs)
            except Exception:
                logger.exception("Worker %d crashed handling job %s", idx, job.id)
            finally:
                self._queue.task_done()

    async def _run(self, job: Job, handler: JobHandler, args: tuple, kwargs: dict) -> None:
        if job.cancel_requested():
            job.status = JOB_STATUS_CANCELLED
            job.finished_at = time.time()
            self._persist(job)
            bus.publish_sync("jobs", {"event": "cancel", "job": job.to_dict()})
            return
        job.status = JOB_STATUS_RUNNING
        job.started_at = time.time()
        self._persist(job)
        bus.publish_sync("jobs", {"event": "start", "job": job.to_dict()})
        try:
            result = await handler(job, *args, **kwargs)
            job.result = result if isinstance(result, dict) else {"value": result}
            job.status = JOB_STATUS_SUCCESS
            job.progress = 100
        except asyncio.CancelledError:
            job.status = JOB_STATUS_CANCELLED
            raise
        except Exception as exc:
            job.status = JOB_STATUS_FAILED
            job.error = f"{exc.__class__.__name__}: {exc}"
            job.log(traceback.format_exc(), level="error")
        finally:
            job.finished_at = time.time()
            self._persist(job)
            bus.publish_sync(
                "jobs",
                {"event": "finish", "job": job.to_dict()},
            )

    def _persist(self, job: Job) -> None:
        try:
            conn = get_db_connection()
            try:
                cur = conn.cursor()
                cur.execute(
                    """
                    INSERT INTO jobs
                        (id, kind, module, title, actor, status, progress, message,
                         payload, result, error, created_at, started_at, finished_at, logs)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        status=excluded.status,
                        progress=excluded.progress,
                        message=excluded.message,
                        result=excluded.result,
                        error=excluded.error,
                        started_at=excluded.started_at,
                        finished_at=excluded.finished_at,
                        logs=excluded.logs
                    """,
                    (
                        job.id,
                        job.kind,
                        job.module,
                        job.title,
                        job.actor,
                        job.status,
                        job.progress,
                        job.message,
                        json.dumps(job.payload, default=str),
                        json.dumps(job.result, default=str) if job.result else None,
                        job.error,
                        job.created_at,
                        job.started_at,
                        job.finished_at,
                        json.dumps(job.logs[-200:], default=str),
                    ),
                )
                conn.commit()
            finally:
                conn.close()
        except sqlite3.Error:
            logger.exception("Failed to persist job %s", job.id)

    def _fetch_persisted(self, job_id: str, *, include_logs: bool) -> Optional[Dict[str, Any]]:
        conn = get_db_connection()
        try:
            cur = conn.cursor()
            cur.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
            row = cur.fetchone()
            if not row:
                return None
            data = dict(row)
            for f in ("payload", "result", "logs"):
                if data.get(f):
                    try:
                        data[f] = json.loads(data[f])
                    except json.JSONDecodeError:
                        pass
            if not include_logs:
                data.pop("logs", None)
            return data
        finally:
            conn.close()


jobs = JobManager()
