import type { Severity } from "@/components/sentra/severity-badge"
import { apiFetch } from "@/lib/api"

/** The lifecycle of a finding (FR-6.2, report Figure 2.6). */
export type FindingStatus =
  | "new"
  | "requires_confirmation"
  | "confirmed"
  | "false_positive"
  | "merged"
  | "fixed_and_verified"
  | "reopened"

export const FINDING_STATUS_LABEL: Record<FindingStatus, string> = {
  new: "New",
  requires_confirmation: "Requires confirmation",
  confirmed: "Confirmed",
  false_positive: "False positive",
  merged: "Merged",
  fixed_and_verified: "Fixed and verified",
  reopened: "Reopened",
}

export type FindingItem = {
  code: string
  title: string
  severity: Severity
  status: FindingStatus
  category: string
  category_name: string
  target: { id: string; name: string }
  component: { kind: string; name: string; label: string }
  evidence_count: number
  first_run: { id: string; code: string }
  last_run: { id: string; code: string }
  first_seen_at: string
  last_seen_at: string
}

export type FindingPage = {
  items: FindingItem[]
  total: number
  page: number
  page_size: number
  counts: { open: number; requires_confirmation: number; closed: number }
}

/** UC-6.4: the organization's findings, the most severe first. The findings pages are M6's own. */
export const listFindings = (params: URLSearchParams, signal?: AbortSignal) =>
  apiFetch<FindingPage>(`/v1/findings?${params}`, { signal })
