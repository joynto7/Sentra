import type { Metadata } from "next"

import { SuiteView } from "@/components/test-library/suite-view"

export async function generateMetadata({ params }: PageProps<"/test-library/suites/[code]">): Promise<Metadata> {
  const { code } = await params
  return { title: code }
}

export default async function SuitePage({ params, searchParams }: PageProps<"/test-library/suites/[code]">) {
  const { code } = await params
  const { version } = await searchParams
  const number = typeof version === "string" ? Number.parseInt(version, 10) : Number.NaN
  return <SuiteView code={code} version={Number.isNaN(number) ? undefined : number} />
}
