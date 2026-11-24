"""Small shared pieces: the rate limit and what the person is told about the assistant."""

import threading
import time
import uuid
from collections import defaultdict, deque

from app.core.errors import AppError

WINDOW_SECONDS = 300
MAX_MESSAGES = 40  # per person in the window: a model call costs money and time


class Limiter:
    """The same idea as the search box's: a sliding window per person, in this process."""

    def __init__(self, window: int = WINDOW_SECONDS, limit: int = MAX_MESSAGES) -> None:
        self.window, self.limit = window, limit
        self._seen: dict[uuid.UUID, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, user_id: uuid.UUID) -> None:
        now = time.monotonic()
        with self._lock:
            seen = self._seen[user_id]
            while seen and now - seen[0] > self.window:
                seen.popleft()
            if len(seen) >= self.limit:
                raise AppError(
                    "You are writing faster than I can answer. Wait a minute and try again.",
                    code="too_many_messages",
                    status_code=429,
                )
            seen.append(now)

    def reset(self) -> None:
        with self._lock:
            self._seen.clear()


limiter = Limiter()
