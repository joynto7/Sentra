import { ATLAS_RETIRED, OWASP_2026, OWASP_EDITION, atlasHref, owaspHref } from "@/lib/frameworks"

// At least 24 px high, the target size of WCAG 2.5.8.
const LINK = "inline-block min-h-6 font-mono leading-6 text-link underline-offset-2 hover:underline"

/** A MITRE ATLAS technique that opens its page. A retired one says what replaced it. */
export function AtlasId({ code, className }: { code: string; className?: string }) {
  const now = ATLAS_RETIRED[code]
  return (
    <span className={className}>
      <a href={atlasHref(code)} target="_blank" rel="noreferrer" className={LINK}>
        {code}
        <span className="sr-only"> on MITRE ATLAS (opens in a new tab)</span>
      </a>
      {now && <span className="text-muted-foreground"> (now {now})</span>}
    </span>
  )
}

/** An OWASP category that opens its page, with its edition and its number in the 2026 edition. */
export function OwaspId({ code, name }: { code: string; name?: string | null }) {
  const later = OWASP_2026[code]
  return (
    <span>
      <a href={owaspHref(code)} target="_blank" rel="noreferrer" className={LINK}>
        {code}
        <span className="sr-only"> on OWASP (opens in a new tab)</span>
      </a>
      {name ? ` ${name}` : ""}
      <span className="block text-xs text-muted-foreground">
        OWASP {OWASP_EDITION}
        {later && later !== code ? ` · ${later} in the 2026 edition` : ""}
      </span>
    </span>
  )
}

/** An OWASP category as a short link, as a finding's header line shows it ("F-002 · LLM06 · …"):
 * the code only, with its edition and its 2026 number for screen readers. */
export function OwaspLink({ code }: { code: string }) {
  const later = OWASP_2026[code]
  return (
    <a href={owaspHref(code)} target="_blank" rel="noreferrer" className={LINK}>
      {code}
      <span className="sr-only">
        {` in the OWASP Top 10 for LLM Applications ${OWASP_EDITION}`}
        {later && later !== code ? `, ${later} in the 2026 edition` : ""} (opens in a new tab)
      </span>
    </a>
  )
}
