import type { Metadata } from "next"

import { SuiteBuilder } from "@/components/test-library/suite-builder"

export const metadata: Metadata = { title: "New Test Suite" }

export default async function NewSuitePage({ searchParams }: PageProps<"/test-library/suites/new">) {
  const { from, test } = await searchParams
  return (
    <SuiteBuilder from={typeof from === "string" ? from : undefined} test={typeof test === "string" ? test : undefined} />
  )
}
