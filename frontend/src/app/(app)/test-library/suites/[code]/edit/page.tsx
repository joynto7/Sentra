import type { Metadata } from "next"

import { SuiteBuilder } from "@/components/test-library/suite-builder"

export async function generateMetadata({ params }: PageProps<"/test-library/suites/[code]/edit">): Promise<Metadata> {
  const { code } = await params
  return { title: `Edit ${code}` }
}

export default async function EditSuitePage({ params }: PageProps<"/test-library/suites/[code]/edit">) {
  const { code } = await params
  return <SuiteBuilder code={code} />
}
