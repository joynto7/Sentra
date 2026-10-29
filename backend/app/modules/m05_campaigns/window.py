"""The optional daily time window of a campaign (FR-5.1, FR-5.4): clock times in the campaign's
time zone, such as 02:00-05:00, or 22:00-02:00 across midnight. A run sends attempts only inside
the window and ends when the window it runs in closes."""

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class Window:
    start: time
    end: time
    zone: ZoneInfo

    @classmethod
    def of(cls, settings: dict) -> "Window | None":
        """The window of a run's settings, or None when the campaign has none."""
        start, end = settings.get("window_start"), settings.get("window_end")
        if not start or not end:
            return None
        return cls(
            time.fromisoformat(start), time.fromisoformat(end), ZoneInfo(settings["time_zone"])
        )

    def _occurrence(self, day: date) -> tuple[datetime, datetime]:
        opens = datetime.combine(day, self.start, self.zone)
        closes_on = day if self.end > self.start else day + timedelta(days=1)
        closes = datetime.combine(closes_on, self.end, self.zone)
        return opens.astimezone(UTC), closes.astimezone(UTC)

    def closes_at(self, now: datetime) -> datetime | None:
        """When the window that `now` is in closes; None when `now` is outside the window."""
        today = now.astimezone(self.zone).date()
        for day in (today - timedelta(days=1), today):
            opens, closes = self._occurrence(day)
            if opens <= now < closes:
                return closes
        return None

    def opens_at(self, now: datetime) -> datetime:
        """When the window opens next."""
        today = now.astimezone(self.zone).date()
        for offset in range(3):
            opens, _ = self._occurrence(today + timedelta(days=offset))
            if opens > now:
                return opens
        raise AssertionError("a daily window opens within three days")

    def label(self) -> str:
        return f"{self.start:%H:%M}–{self.end:%H:%M} ({self.zone.key})"
