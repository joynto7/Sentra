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
    # UC-11.4 step 7: every repetition of a benchmark run has ended (FR-11.3)
    Event("benchmark_run_finished", "Benchmark run finished"),
    # UC-5.3, 3a1 and 4a1: a scheduled run didn't start (FR-5.3), or the schedule was cancelled
    # because its target was archived (FR-2.6; UC-2.6 step 5)
    Event("campaign_schedule_problem", "Scheduled campaign that can't run"),
    # UC-6.2, 2b1: a finding that had been fixed and verified came back (FR-6.6)
    Event("finding_reopened", "Finding reopened as a regression", tab="assigned"),
    # UC-2.4 step 4: the mapping of a target profile has finished
    Event("target_profile_ready", "Target profile ready for review"),
    # UC-3.1 step 6: a new draft of a threat model awaits a Security Analyst
    Event("threat_model_ready", "Threat model ready for review"),
    # UC-8.2 step 6: the remediation proposal of a finding is ready for its review
    Event("remediation_ready", "Remediation proposal ready for review"),
    # UC-8.3 step 6: the proposal somebody sent for approval was approved or rejected
    Event("remediation_decided", "Remediation approved or rejected", tab="approvals"),
    # UC-8.4 steps 5-6 and 4a1: the target's Shield Policy version is active, or it is not
    Event("shield_policy", "Sentra Shield policy deployed or failed"),
    # UC-9.6, 3a1: an API key is about to expire, so it can be replaced in time
    Event("api_key_expiring", "API key about to expire"),
    Event(
        "account_security",
        "Account security alerts (password changes, new logins)",
        locked=True,
    ),
]
BY_KEY = {event.key: event for event in EVENTS}
