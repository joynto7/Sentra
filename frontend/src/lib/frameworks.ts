/**
 * The two frameworks Sentra maps to, and how they moved.
 *
 * MITRE ATLAS 2026.10 (28 October 2026) retired two techniques. Stored threat models, findings and
 * old versions of tests keep the ID they were made with, so those are shown with what replaced them.
 *
 * The OWASP Top 10 for LLM Applications 2026 (August 2026) has the same risks under other numbers.
 * Sentra stays on the 2025 edition, which its report and data use, and shows the 2026 number beside it.
 */
export const ATLAS_VERSION = "2026.10"

export const ATLAS_RETIRED: Record<string, string> = {
  "AML.T0056": "AML.T0085.003",
  "AML.T0057": "AML.T0085.002",
}

export const OWASP_EDITION = "2025"

export const OWASP_2026: Record<string, string> = {
  LLM01: "LLM01",
  LLM02: "LLM02",
  LLM03: "LLM04",
  LLM04: "LLM05",
  LLM05: "LLM10",
  LLM06: "LLM03",
  LLM07: "LLM08",
  LLM08: "LLM09",
  LLM09: "LLM07",
  LLM10: "LLM06",
}

const OWASP_PAGES: Record<string, string> = {
  LLM01: "llm01-prompt-injection",
  LLM02: "llm022025-sensitive-information-disclosure",
  LLM03: "llm032025-supply-chain",
  LLM04: "llm042025-data-and-model-poisoning",
  LLM05: "llm052025-improper-output-handling",
  LLM06: "llm062025-excessive-agency",
  LLM07: "llm072025-system-prompt-leakage",
  LLM08: "llm082025-vector-and-embedding-weaknesses",
  LLM09: "llm092025-misinformation",
  LLM10: "llm102025-unbounded-consumption",
}

export function owaspHref(code: string): string {
  const page = OWASP_PAGES[code]
  return page ? `https://genai.owasp.org/llmrisk/${page}/` : "https://genai.owasp.org/llm-top-10/"
}

/** A retired technique has no page any more, so it links to what replaced it. */
export function atlasHref(code: string): string {
  return `https://atlas.mitre.org/techniques/${ATLAS_RETIRED[code] ?? code}`
}
