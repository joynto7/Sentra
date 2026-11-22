"""The two formats a report is exported in (UC-9.1 step 3): JSON for other tools, PDF for reading.

Both are written from the same document, so a PDF and a JSON of the same report hold the same
numbers. The PDF is laid out with reportlab, the only package this feature adds: it is pure
Python, needs no system libraries, and the project's own report PDFs are built with it.
"""

import json
from datetime import datetime
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

SEVERITIES = ["critical", "high", "medium", "low", "informational"]


def to_json(document: dict) -> bytes:
    """The document itself, formatted so a person can read it too (NFR-4.2)."""
    return json.dumps(document, indent=2, ensure_ascii=False, default=str).encode()


def _date(value: Any) -> str:
    if not value:
        return "—"
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError:
            return value
    return value.strftime("%d %b %Y")


def _counts(by_severity: dict) -> str:
    parts = [
        f"{by_severity.get(one, 0)} {one.capitalize()}"
        for one in SEVERITIES
        if by_severity.get(one)
    ]
    return " · ".join(parts) or "none"


def _styles() -> dict:
    sheet = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("title", parent=sheet["Title"], fontSize=20, spaceAfter=4),
        "sub": ParagraphStyle(
            "sub", parent=sheet["Normal"], fontSize=10, textColor=colors.HexColor("#5c5f66")
        ),
        "h2": ParagraphStyle("h2", parent=sheet["Heading2"], fontSize=13, spaceBefore=14),
        "body": ParagraphStyle("body", parent=sheet["Normal"], fontSize=10, leading=14),
        "small": ParagraphStyle(
            "small", parent=sheet["Normal"], fontSize=8.5, textColor=colors.HexColor("#5c5f66")
        ),
    }


def _table(rows: list[list[str]], widths: list[float]) -> Table:
    table = Table(rows, colWidths=widths, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f3f5")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#1f2225")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#dee2e6")),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table


def _header(document: dict, styles: dict) -> list:
    head = document["report"]
    scope = head["scope"]
    where = scope.get("target") or scope.get("campaign_run") or "All targets"
    period = head["period"]
    line = f"{where} · generated {_date(head['generated_at'])}"
    if period["from"] and period["to"]:
        line += f" · period {_date(period['from'])} to {_date(period['to'])}"
    if scope.get("category"):
        line += f" · {scope['category']} only"
    return [
        Paragraph(head["title"], styles["title"]),
        Paragraph(f"{head['code']} · Sentra", styles["sub"]),
        Paragraph(line, styles["sub"]),
        Spacer(1, 8),
    ]


def _unconfirmed(document: dict, styles: dict) -> list:
    """2a1: they are listed apart, and the sentence says they are not counted."""
    rows = document.get("unconfirmed") or [
        one for one in document.get("findings", []) if one.get("needs_confirmation")
    ]
    if not rows:
        return []
    table = [["Finding", "Severity", "Target"]] + [
        [one["code"], one["severity"].capitalize(), one.get("target", "")] for one in rows
    ]
    return [
        Paragraph("Findings that still require confirmation", styles["h2"]),
        Paragraph(
            "Only Sentra's LLM judge supports these findings so far. They are listed here and are "
            "not counted in the summary until a security analyst has confirmed them.",
            styles["body"],
        ),
        Spacer(1, 6),
        _table(table, [70, 70, 240]),
    ]


def _executive_pdf(document: dict, styles: dict) -> list:
    story = _header(document, styles)
    summary = document["summary"]
    story += [
        Paragraph("Where the risk stands", styles["h2"]),
        Paragraph(
            f"{summary['open_total']} findings are open ({_counts(summary['open_by_severity'])}). "
            f"{summary['awaiting_triage']} wait for triage and {summary['awaiting_remediation']} "
            f"for a fix; {summary['fixed_and_verified']} were fixed and verified in this period. "
            f"The last campaign run ended on {_date(summary['last_run_at'])}.",
            styles["body"],
        ),
        Spacer(1, 6),
    ]
    targets = [["Target", "Risk score", "Open findings", "Last run"]]
    for row in document["targets"]:
        score = f"{row['score']} {row['band'].capitalize()}" if row["score"] is not None else "—"
        targets.append(
            [
                f"{row['name']} ({row['environment']})",
                score,
                _counts(row["open_by_severity"]),
                _date(row["last_run_at"]),
            ]
        )
    story += [_table(targets, [150, 80, 150, 70])]
    trend = document["trend"]
    if trend["buckets"]:
        story += [
            Paragraph("How it developed", styles["h2"]),
            Paragraph(
                f"{sum(b['new'] for b in trend['buckets'])} findings came in and "
                f"{sum(b['closed'] for b in trend['buckets'])} were closed in this period "
                f"({trend['net_change']:+d} open findings).",
                styles["body"],
            ),
            Spacer(1, 6),
            _table(
                [["From", "New", "Closed"]]
                + [
                    [_date(bucket["starts_at"]), str(bucket["new"]), str(bucket["closed"])]
                    for bucket in trend["buckets"]
                ],
                [150, 100, 100],
            ),
        ]
    if document["coverage"]:
        story += [
            Paragraph("What has been tested", styles["h2"]),
            _table(
                [["Category", "Open findings", "Coverage"]]
                + [
                    [f"{row['code']} {row['name']}", str(row["open_total"]), row["label"]]
                    for row in document["coverage"]
                ],
                [250, 90, 110],
            ),
        ]
    if document["recommendations"]:
        story += [Paragraph("What to do first", styles["h2"])]
        for one in document["recommendations"]:
            label = " (AI-generated proposal)" if one["ai_generated"] else ""
            story += [
                Paragraph(
                    f"<b>{one['code']} {one['title']}</b> — {one['severity'].capitalize()}, "
                    f"{one['target']}",
                    styles["body"],
                ),
                Paragraph(f"{one['recommendation']}{label}", styles["small"]),
                Spacer(1, 4),
            ]
    story += _unconfirmed(document, styles)
    return story


def _verification(verified: dict | None, styles: dict) -> list:
    """UC-8.7, 5c1: the before-and-after comparison of the finding's retest, as the evidence a
    manager puts in front of management or an auditor. Every rate carries its counts (quality
    requirement 2), and the conclusion is the sentence the retest wrote (NFR-4.2).
    """
    if not verified:
        return []
    what = [
        ["Verdict", verified["verdict_label"] or "—"],
        ["Attack success before", verified["attack_success_before"]],
        ["Attack success after", verified["attack_success_after"]],
        [
            "Normal use affected",
            verified["normal_use_affected"]
            + (" · generic examples" if verified["normal_use_generic_set"] else ""),
        ],
    ]
    if verified["risk_before"] is not None and verified["risk_after"] is not None:
        what.append(["Risk score", f"{verified['risk_before']} → {verified['risk_after']}"])
    what.append(
        [
            "What was verified",
            (
                f"Shield Policy v{verified['policy_version']}"
                if verified["policy_version"]
                else "application changes only"
            )
            + (
                f" · {verified['changes_marked']} application "
                + ("change" if verified["changes_marked"] == 1 else "changes")
                if verified["changes_marked"]
                else ""
            )
            + f" · {verified['test']}, {verified['repetitions']} repetitions",
        ]
    )
    story = [
        Spacer(1, 4),
        Paragraph(f"Verification (retest {verified['retest']})", styles["small"]),
        _table(what, [90, 360]),
    ]
    if verified["conclusion"]:
        story += [Spacer(1, 3), Paragraph(verified["conclusion"], styles["small"])]
    if verified["out_of_date"]:
        story += [
            Paragraph(
                "A rollback has since taken what this retest proved out of the traffic.",
                styles["small"],
            )
        ]
    return story


def _technical_pdf(document: dict, styles: dict) -> list:
    story = _header(document, styles)
    summary = document["summary"]
    story += [
        Paragraph("Summary", styles["h2"]),
        Paragraph(
            f"{summary['findings']} findings are counted ({_counts(summary['by_severity'])}), and "
            f"{summary['unconfirmed']} still require confirmation.",
            styles["body"],
        ),
    ]
    for one in document["findings"]:
        story += [
            Paragraph(f"{one['code']} {one['title']}", styles["h2"]),
            _table(
                [
                    ["Severity", one["severity"].capitalize()],
                    ["Status", one["status"].replace("_", " ").capitalize()],
                    ["Target", one["target"]],
                    ["Component", one["component"]],
                    [
                        "Category",
                        f"{one['category']} {one.get('category_name') or ''}"
                        + (f" · {', '.join(one['atlas'])}" if one.get("atlas") else ""),
                    ],
                    ["Test", one["test"]],
                    ["Reproduced", f"{one['reproducibility']}" if one["reproducibility"] else "—"],
                    ["First seen", _date(one["first_seen_at"])],
                    ["Evidence", f"{one['evidence_count']} records · {one['evidence_note']}"],
                ],
                [90, 360],
            ),
        ]
        fix = one.get("remediation")
        if fix:
            label = " (AI-generated)" if fix["ai_generated"] else ""
            story += [
                Spacer(1, 4),
                Paragraph(
                    f"Remediation: version {fix['version']}, {fix['status']}{label} — "
                    f"{fix['summary']}",
                    styles["small"],
                ),
            ]
        story += _verification(one.get("verification"), styles)
        story += [Spacer(1, 6)]
    if document.get("findings") and any(
        one.get("needs_confirmation") for one in document["findings"]
    ):
        story += [PageBreak()] + _unconfirmed(document, styles)
    return story


def to_pdf(document: dict) -> bytes:
    """The report as a PDF, in the plain layout of the capstone's own documents."""
    from io import BytesIO

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=document["report"]["title"],
        author="Sentra",
    )
    styles = _styles()
    story = (
        _executive_pdf(document, styles)
        if document["report"]["type"] == "executive"
        else _technical_pdf(document, styles)
    )
    doc.build(story)
    return buffer.getvalue()
