import type { Metadata } from "next"

import { FindingEvidence } from "@/components/findings/finding-evidence"

export async function generateMetadata({ params }: PageProps<"/findings/[code]/evidence">): Promise<Metadata> {
  const { code } = await params
  return { title: `${code} evidence` }
}

export default async function FindingEvidencePage({ params }: PageProps<"/findings/[code]/evidence">) {
  const { code } = await params
  return <FindingEvidence code={code} />
}
