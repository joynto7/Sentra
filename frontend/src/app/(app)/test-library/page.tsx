import type { Metadata } from "next"

import { PageHeader } from "@/components/layout/page-header"
import { CatalogueActions } from "@/components/test-library/catalogue"
import { TestLibrary } from "@/components/test-library/test-library"

export const metadata: Metadata = { title: "Test Library" }

export default async function TestLibraryPage({ searchParams }: PageProps<"/test-library">) {
  const { tab } = await searchParams
  return (
    <>
      <PageHeader
        title="Test Library"
        description="Security tests and suites."
        action={<CatalogueActions />}
      />
      <TestLibrary tab={tab === "suites" ? "suites" : "tests"} />
    </>
  )
}
