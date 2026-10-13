"""The events a user can be notified about (FR-9.3): the rows of the preferences table on the
Profile page (Screen 08) and the tabs of the notification centre (Screen 54)."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Event:
    key: str
    label: str
    tab: str = ""  # "assigned" or "approvals": the tab of the notification centre besides "All"
    locked: bool = False  # always on, in both channels (UC-9.3, quality requirement 2)


EVENTS = [
    Event("campaign_run_completed", "Campaign run completed"),
    Event("finding_critical_high", "New Critical or High finding"),
    Event("approval_requested", "Approval requested from me", tab="approvals"),
    Event("finding_assigned", "Finding assigned to me", tab="assigned"),
    Event("retest_finished", "Retest finished"),
    Event("report_ready", "Report ready"),
    Event("usage_limit_warning", "Usage limit warning"),
    Event(
        "account_security",
        "Account security alerts (password changes, new logins)",
        locked=True,
    ),
]
BY_KEY = {event.key: event for event in EVENTS}
