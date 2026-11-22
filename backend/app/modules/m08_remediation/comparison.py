"""The before-and-after comparison of a retest (FR-8.5; UC-8.7), as Screen 51 shows it.

Three measurements and one sentence:

1. **attack success** — how many of the repeated attempts succeeded before the fix and how many
   after it, as counts and as rates over repeated attempts, never as single outcomes (quality
   requirement 2);
2. **normal use** — the share of the benign requests the fix refused or changed, with the examples
   themselves, so that a person can judge whether the answers still do their job (step 3);
3. **the target's risk score** before and after (step 4).

Every figure is written out beside its chart, so the comparison reads as a table as well as a
picture (NFR-4.3), and the conclusion says in plain language what changed and what it means
(NFR-4.2) — including when the measurement does not support a conclusion at all.
"""

from app.modules.m06_findings.models import Finding
from app.modules.m08_remediation.models import (
    BenignOutcome,
    BenignReview,
    Retest,
    RetestStatus,
    RetestVerdict,
)

VERDICT_LABELS = {
    RetestVerdict.CLOSED: "Fixed and Verified",
    RetestVerdict.STILL_OPEN: "Still open",
    RetestVerdict.INCONCLUSIVE: "Not measured",
}
STATUS_LABELS = {
    RetestStatus.TESTING: "Repeating the attempts that found the weakness",
    RetestStatus.CHECKING: "Checking the requests of normal use",
    RetestStatus.COMPLETED: "Finished",
    RetestStatus.FAILED: "Couldn't run",
    RetestStatus.CANCELLED: "Cancelled",
}
OUTCOME_LABELS = {
    BenignOutcome.ANSWERED: "Answered as before",
    BenignOutcome.BLOCKED: "Refused by the policy",
    BenignOutcome.CHANGED: "Changed by the policy",
    BenignOutcome.FAILED: "No answer",
}
REVIEW_LABELS = {
    BenignReview.PENDING: "Not reviewed",
    BenignReview.FINE: "Looks fine",
    BenignReview.NEEDS_REVISION: "Needs revision",
}
LESS_RELIABLE = (
    "This target has no Benign Request Set of its own, so the effect on normal use was measured "
    "with a generic set and is less reliable."
)
NO_BENIGN = "No request of normal use was answered, so the effect on normal use isn't measured."


def rate(successes: int, attempts: int) -> float | None:
    """A rate over repeated attempts, as a percentage with one decimal; None without attempts."""
    return round(successes * 100 / attempts, 1) if attempts else None


def as_words(successes: int, attempts: int, unit: str = "attempts") -> str:
    """Every figure of a chart in words as well (NFR-4.3): "4 of 5 attempts (80 %)"."""
    if not attempts:
        return "not measured"
    return f"{successes} of {attempts} {unit} ({rate(successes, attempts):g} %)"


def affected(retest: Retest) -> int:
    return retest.benign_blocked + retest.benign_changed


def conclusion(retest: Retest, finding: Finding) -> str:
    """What the comparison means, in plain language (NFR-4.2). It is written when the retest ends
    and kept with it, so that the sentence a person was told is the sentence they read later."""
    after = f"{retest.after_successes} of {retest.after_attempts}"
    before = f"{retest.before_successes} of {retest.before_attempts}"
    verdict = RetestVerdict(retest.verdict) if retest.verdict else RetestVerdict.INCONCLUSIVE
    if verdict == RetestVerdict.CLOSED:
        said = (
            f"The fix closes the weakness: no repeated attempt succeeded after it ({after}), "
            f"against {before} before."
        )
    elif verdict == RetestVerdict.STILL_OPEN:
        said = (
            f"The weakness is still there: {after} repeated attempts succeeded after the fix, "
            f"against {before} before. {finding.code} stays open."
        )
    else:
        planned = len(retest.replayed or []) * retest.repetitions
        succeeded = (
            f", and {retest.after_successes} of them succeeded"
            if retest.after_successes
            else ", and none of them succeeded"
            if retest.after_attempts
            else ""
        )
        said = (
            f"This retest doesn't say whether the weakness is closed: "
            f"{retest.after_attempts} of {planned} repeated attempts were evaluated"
            f"{succeeded}. {finding.code} stays as it was."
        )
    said += " " + _normal_use(retest)
    if retest.benign_generic and retest.benign_total:
        said += " " + LESS_RELIABLE
    if retest.risk_before is not None and retest.risk_after is not None:
        if retest.risk_after == retest.risk_before:
            said += f" The target's risk score stays at {retest.risk_before}."
        else:
            said += (
                f" The target's risk score moves from {retest.risk_before} to {retest.risk_after}."
            )
    return said


def _normal_use(retest: Retest) -> str:
    """UC-8.7 step 3 in one sentence: what the fix did to the requests of normal use."""
    if not retest.benign_total:
        return NO_BENIGN
    blocked, changed, total = retest.benign_blocked, retest.benign_changed, retest.benign_total
    if not blocked and not changed:
        return (
            f"All {total} requests of normal use were answered as before."
            if total > 1
            else "The one request of normal use was answered as before."
        )
    parts = []
    if blocked:
        parts.append(f"{blocked} was refused" if blocked == 1 else f"{blocked} were refused")
    if changed:
        parts.append(f"{changed} was changed" if changed == 1 else f"{changed} were changed")
    return (
        f"Of {total} requests of normal use, {' and '.join(parts)}: review "
        + ("it" if blocked + changed == 1 else "them")
        + " before keeping the fix."
    )


def figures(retest: Retest) -> dict:
    """The three comparison cards of Screen 51, each with its figures in words (NFR-4.3)."""
    return {
        "attack_success": {
            "before_successes": retest.before_successes,
            "before_attempts": retest.before_attempts,
            "before_rate": rate(retest.before_successes, retest.before_attempts),
            "before_words": as_words(retest.before_successes, retest.before_attempts),
            "after_successes": retest.after_successes,
            "after_attempts": retest.after_attempts,
            "after_rate": rate(retest.after_successes, retest.after_attempts),
            "after_words": as_words(retest.after_successes, retest.after_attempts),
        },
        "normal_use": {
            "total": retest.benign_total,
            "blocked": retest.benign_blocked,
            "changed": retest.benign_changed,
            "failed": retest.benign_failed,
            "affected": affected(retest),
            "affected_rate": rate(affected(retest), retest.benign_total),
            "affected_words": as_words(affected(retest), retest.benign_total, "requests"),
            "generic_set": retest.benign_generic,
        },
        "risk_score": {
            "before": retest.risk_before,
            "band_before": retest.risk_band_before,
            "after": retest.risk_after,
            "band_after": retest.risk_band_after,
            "change": (
                retest.risk_after - retest.risk_before
                if retest.risk_before is not None and retest.risk_after is not None
                else None
            ),
        },
    }
