import type { Metadata } from "next"

import { RunMonitor } from "@/components/campaigns/run-monitor"

export async function generateMetadata({ params }: PageProps<"/campaigns/[code]/runs/[number]">): Promise<Metadata> {
  const { code, number } = await params
  return { title: `Run ${code}-${number}` }
}

export default async function RunPage({ params }: PageProps<"/campaigns/[code]/runs/[number]">) {
  const { code, number } = await params
  return <RunMonitor code={code} number={Number(number)} />
}
