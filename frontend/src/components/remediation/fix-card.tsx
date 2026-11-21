import { EnforcementChip } from "@/components/remediation/badges"
import { DETAIL_KEY, DETAIL_TITLE, type Fix } from "@/lib/remediation"

/**
 * The fix itself, by kind: a prompt is text, a guardrail and a code change are lines, and a tool
 * or retrieval fix is rows of the thing it is about and the rule for it — the shape FR-8.3 builds
 * a policy rule from, so it is shown as such and never flattened into one line.
 */
function Body({ fix }: { fix: Fix }) {
  const value = fix.details[DETAIL_KEY[fix.kind]]
  if (typeof value === "string" && value.trim()) {
    return (
      <p className="mt-1 rounded-[7px] border bg-muted/40 p-3 font-mono text-[13px] whitespace-pre-wrap">
        {value}
      </p>
    )
  }
  const list = Array.isArray(value) ? value : []
  const lines = list
    .map((one) =>
      typeof one === "string"
        ? one
        : one && typeof one === "object"
          ? Object.entries(one as Record<string, unknown>)
              .map(([, text]) => String(text))
              .filter(Boolean)
              .join(" — ")
          : "",
    )
    .filter(Boolean)
  if (lines.length === 0) return null
  return (
    <ul className="mt-1 space-y-1 rounded-[7px] border bg-muted/40 p-3 font-mono text-[13px]">
      {lines.map((line, index) => (
        <li key={index} className="flex gap-2">
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          {line}
        </li>
      ))}
    </ul>
  )
}

/**
 * One recommended fix (FR-8.1): what kind it is, where it takes effect (UC-8.2 step 6), what it
 * changes in plain language and the fix itself. While no Sentra Shield gateway protects the
 * target, the note says why a fix a gateway could carry is a change in the application (6a).
 */
export function FixCard({ fix }: { fix: Fix }) {
  return (
    <li className="rounded-[10px] border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular text-xs text-muted-foreground">{fix.position}</span>
        <h3 className="text-[15px] font-semibold">{fix.title}</h3>
        <span className="rounded-md border border-border-strong px-2 py-0.5 text-xs text-text-secondary">
          {fix.kind_label}
        </span>
        <EnforcementChip enforcement={fix.enforcement} />
      </div>
      <p className="mt-2 text-sm text-text-secondary">{fix.description}</p>
      <h4 className="mt-3 text-[13px] font-medium text-muted-foreground">{DETAIL_TITLE[fix.kind]}</h4>
      <Body fix={fix} />
      {fix.enforcement_note && (
        <p className="mt-2 text-xs text-muted-foreground">{fix.enforcement_note}</p>
      )}
    </li>
  )
}
