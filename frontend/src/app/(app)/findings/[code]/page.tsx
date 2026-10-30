import type { Metadata } from "next"

import { FindingView } from "@/components/findings/finding-view"

export async function generateMetadata({ params }: PageProps<"/findings/[code]">): Promise<Metadata> {
  const { code } = await params
  return { title: code }
}

export default async function FindingPage({ params }: PageProps<"/findings/[code]">) {
  const { code } = await params
  return <FindingView code={code} />
}
