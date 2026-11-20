import type { Metadata } from "next"

import { VersionsPage } from "@/components/threat-models/versions-page"

export const metadata: Metadata = { title: "Threat model versions" }

const number = (value: string | string[] | undefined) =>
  typeof value === "string" && /^\d{1,6}$/.test(value) ? Number(value) : null

/** Screen 28: the versions of a target's threat model and what changed between two of them
 * (UC-3.4). `?base=2&compare=3` opens a comparison straight away. */
export default async function Versions({ params, searchParams }: PageProps<"/threat-models/[targetId]/versions">) {
  const { targetId } = await params
  const { base, compare } = await searchParams
  return <VersionsPage targetId={targetId} initialBase={number(base)} initialCompare={number(compare)} />
}
