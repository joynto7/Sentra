"""When a recurring campaign schedule runs next (FR-5.3, UC-5.1 step 5): a clock time in the
campaign's own time zone, every day, on one weekday, or on one day of the month.

The clock time is what the analyst sees, so the moment follows the time zone's summer time: a
schedule for 02:00 in Asia/Dhaka or Europe/Berlin keeps running at 02:00 local time all year. On
the one day a year a time zone skips an hour, the clock time the schedule asks for doesn't exist;
the run then starts at the same instant as the hour before the change, an hour later by the clock.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

WEEKDAYS = (
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
)
MAX_DAY_OF_MONTH = 28  # so the day exists in every month


@dataclass(frozen=True)
class Recurrence:
    frequency: str
    at_time: time
    zone: ZoneInfo
    weekday: int | None = None  # weekly: 0 = Monday … 6 = Sunday, as datetime.weekday() counts
    day_of_month: int | None = None  # monthly: 1 to 28

    def next_after(self, moment: datetime) -> datetime:
        """The first moment of this recurrence after `moment`, in UTC."""
        today = moment.astimezone(self.zone).date()
        for day in self._days(today):
            when = datetime.combine(day, self.at_time, self.zone).astimezone(UTC)
            if when > moment:
                return when
        raise AssertionError(f"a {self.frequency} schedule has a next time")

    def _days(self, today: date) -> list[date]:
        """The two local days that can hold the next time: the one that may still come today (or
        this week, or this month) and the one after it, in case its time has passed."""
        if self.frequency == "weekly":
            ahead = ((self.weekday or 0) - today.weekday()) % 7
            return [today + timedelta(days=ahead), today + timedelta(days=ahead + 7)]
        if self.frequency == "monthly":
            day = min(self.day_of_month or 1, MAX_DAY_OF_MONTH)
            later = (today.replace(day=MAX_DAY_OF_MONTH) + timedelta(days=7)).replace(day=day)
            return [today.replace(day=day), later]
        return [today, today + timedelta(days=1)]

    def label(self) -> str:
        """In words, for the campaign's page and the audit log: "Every Monday at 02:00 (UTC)"."""
        clock = f"{self.at_time:%H:%M} ({self.zone.key})"
        if self.frequency == "weekly":
            return f"Every {WEEKDAYS[self.weekday or 0]} at {clock}"
        if self.frequency == "monthly":
            return f"On day {self.day_of_month} of each month at {clock}"
        return f"Every day at {clock}"
