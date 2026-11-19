import type { Metadata } from "next"

import { TestDefinitionView } from "@/components/test-library/definition-view"

export async function generateMetadata({ params }: PageProps<"/test-library/[code]">): Promise<Metadata> {
  const { code } = await params
  return { title: code }
}

export default async function TestDefinitionPage({ params, searchParams }: PageProps<"/test-library/[code]">) {
  const { code } = await params
  const { version } = await searchParams
  const number = typeof version === "string" ? Number.parseInt(version, 10) : Number.NaN
  return <TestDefinitionView code={code} version={Number.isNaN(number) ? undefined : number} />
}
