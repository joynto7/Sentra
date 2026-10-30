import type { Metadata } from "next"

import { AttackPaths } from "@/components/risk/attack-paths"

export const metadata: Metadata = { title: "Attack Paths" }

export default async function AttackPathsPage({ searchParams }: PageProps<"/attack-paths">) {
  // A finding and the risk dashboard link here with the target they are about.
  const { target } = await searchParams
  return <AttackPaths target={typeof target === "string" ? target : undefined} />
}
