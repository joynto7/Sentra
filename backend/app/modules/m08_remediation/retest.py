"""What follows a deployment (UC-8.4 step 6, with 6a).

A finding is retested once **every** fix of its approved proposal is in effect: the gateway fixes
when the policy version is active (UC-8.4), and the application changes when the developer marks
them as implemented (UC-8.5, 6a1). Both of those are FR-8.4 and FR-8.5, the next two tasks of this
sprint; `after_deployment()` and `open_application_fixes()` are the two functions they replace.

Until then a remediation stays `applying` after its policy is active, which is exactly what it is:
the fixes are in effect and the proof is still missing. A rollback (UC-8.8) takes them out again,
and `after_rollback()` is where FR-8.4 cancels the retest that was waiting for them.
"""

from sqlalchemy.orm import Session

from app.modules.m06_findings.models import Finding
from app.modules.m08_remediation.models import (
    Enforcement,
    Remediation,
    ShieldPolicy,
)


def open_application_fixes(remediation: Remediation) -> list[str]:
    """6a1: the fixes of the proposal that a person still has to carry out in the application.
    FR-8.5 will mark them as implemented one by one; today the list is what Screen 46 reads."""
    return [fix.title for fix in remediation.fixes if fix.enforcement == Enforcement.APPLICATION]


def after_rollback(db: Session, *, finding: Finding, remediation: Remediation) -> None:
    """UC-8.8 step 5: the fixes of this proposal are out of the traffic again, so a retest that
    was waiting for them has nothing left to prove.

    FR-8.4 replaces this function with the cancellation of the pending retest run and, when the
    finding was already verified, with the before-and-after comparison that is now out of date.
    Today there is no retest to cancel: the proposal is back to `approved` and its finding is open.
    """
    return None


def after_deployment(
    db: Session, *, finding: Finding, remediation: Remediation, policy: ShieldPolicy
) -> None:
    """Step 6: start the retest of the finding when nothing of the proposal is open any more.

    FR-8.4 (UC-8.6) replaces this function with the retest run itself: the tests that found the
    weakness plus the benign request set, through the same run engine and the same limits. It is
    the single place that task has to change, so nothing else of UC-8.4 moves with it.
    """
    return None
