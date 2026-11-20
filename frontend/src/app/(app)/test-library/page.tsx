import type { Metadata } from "next"

import { PageHeader } from "@/components/layout/page-header"
import { CatalogueActions, TestCatalogue } from "@/components/test-library/catalogue"

export const metadata: Metadata = { title: "Test Library" }

export default function TestLibraryPage() {
  return (
    <>
      <PageHeader
        title="Test Library"
        description="Declarative security tests, mapped to OWASP and MITRE ATLAS."
        action={<CatalogueActions />}
      />
      <TestCatalogue />
    </>
  )
}
