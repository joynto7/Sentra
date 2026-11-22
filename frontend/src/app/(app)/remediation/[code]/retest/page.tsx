import type { Metadata } from "next"

import { RetestView } from "@/components/remediation/retest-view"

export async function generateMetadata({
  params,
}: PageProps<"/remediation/[code]/retest">): Promise<Metadata> {
  const { code } = await params
  return { title: `Retest of ${code}` }
}

export default async function RetestPage({
  params,
  searchParams,
}: PageProps<"/remediation/[code]/retest">) {
  const { code } = await params
  const { number } = await searchParams
  const asked = Number(Array.isArray(number) ? number[0] : number)
  return <RetestView code={code} number={Number.isFinite(asked) && asked > 0 ? asked : undefined} />
}
