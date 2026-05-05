"""
Server-Sent Events (SSE) bus for CoPanel.

A tiny in-process pub/sub used by job runners and modules to broadcast
realtime updates (job progress, notifications, audit events, ...) to any
connected frontend client. No external dependency required.

Topics in use:
    - ``jobs``           - job status/progress updates
    - ``notifications``  - user-facing toasts / inbox items
    - ``audit``          - administrative audit events (admin only)
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, AsyncIterator, Dict, List, Optional, Set

logger = logging.getLogger(__name__)


class EventBus:
    """Asyncio in-process pub/sub.

    Subscribers receive events posted after they subscribe. Slow subscribers
    are dropped (per-queue maxsize) so a stuck client never holds back the
    rest of the system.
    """

    def __init__(self, queue_size: int = 256) -> None:
        self._queue_size = queue_size
        self._subscribers: Dict[str, Set[asyncio.Queue]] = {}

    def _topic_set(self, topic: str) -> Set[asyncio.Queue]:
        return self._subscribers.setdefault(topic, set())

    async def publish(self, topic: str, payload: Dict[str, Any]) -> None:
        """Broadcast ``payload`` to all subscribers of ``topic``."""
        message = {
            "topic": topic,
            "ts": int(time.time() * 1000),
            "payload": payload,
        }
        for queue in list(self._topic_set(topic)):
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                logger.debug("Dropping event for slow subscriber on topic %s", topic)

    def publish_sync(self, topic: str, payload: Dict[str, Any]) -> None:
        """Publish from synchronous code by scheduling onto the running loop.

        Falls back to a fire-and-forget if no loop is running (e.g. in tests).
        """
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(self.publish(topic, payload))

    async def subscribe(self, topics: List[str]) -> AsyncIterator[Dict[str, Any]]:
        queue: asyncio.Queue = asyncio.Queue(maxsize=self._queue_size)
        for t in topics:
            self._topic_set(t).add(queue)
        try:
            while True:
                msg = await queue.get()
                yield msg
        finally:
            for t in topics:
                self._topic_set(t).discard(queue)


bus = EventBus()


def sse_format(message: Dict[str, Any]) -> str:
    """Format a payload as a single SSE message frame."""
    data = json.dumps(message, ensure_ascii=False, default=str)
    return f"event: {message.get('topic', 'message')}\ndata: {data}\n\n"


async def sse_stream(topics: Optional[List[str]] = None, heartbeat_seconds: float = 15.0) -> AsyncIterator[str]:
    """Async generator producing SSE-formatted strings for ``StreamingResponse``."""
    chosen = topics or ["jobs", "notifications"]
    sub = bus.subscribe(chosen)
    last_emit = time.monotonic()
    try:
        while True:
            try:
                msg = await asyncio.wait_for(sub.__anext__(), timeout=heartbeat_seconds)
                yield sse_format(msg)
                last_emit = time.monotonic()
            except asyncio.TimeoutError:
                if time.monotonic() - last_emit >= heartbeat_seconds:
                    yield ": ping\n\n"
                    last_emit = time.monotonic()
    finally:
        try:
            await sub.aclose()
        except Exception:
            pass
