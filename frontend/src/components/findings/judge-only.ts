import type { FindingDetection } from "@/lib/findings"

/**
 * Only the LLM judge supports the finding: it met, and no deterministic method did. A finding can wait for
 * confirmation for another reason, and then the page must not say this (it would contradict the checks below it).
 */
export function onlyJudgeSupports(detection: FindingDetection | null): boolean {
  if (!detection) return false
  const met = detection.methods.filter((method) => method.outcome === "met")
  return met.length > 0 && met.every((method) => method.method === "llm_judge")
}
