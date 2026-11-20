import type { Metadata } from "next"

import { CustomTestEditor } from "@/components/test-library/custom-test-editor"

export async function generateMetadata({ params }: PageProps<"/test-library/[code]/edit">): Promise<Metadata> {
  const { code } = await params
  return { title: `Edit ${code}` }
}

export default async function EditCustomTestPage({ params }: PageProps<"/test-library/[code]/edit">) {
  const { code } = await params
  return <CustomTestEditor code={code} />
}
