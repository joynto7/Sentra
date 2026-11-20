import type { Metadata } from "next"

import { CustomTestEditor } from "@/components/test-library/custom-test-editor"

export const metadata: Metadata = { title: "New Custom Test" }

export default async function NewCustomTestPage({ searchParams }: PageProps<"/test-library/new">) {
  const { from } = await searchParams
  return <CustomTestEditor from={typeof from === "string" ? from : undefined} />
}
