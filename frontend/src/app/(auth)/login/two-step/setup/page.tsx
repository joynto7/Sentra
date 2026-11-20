import type { Metadata } from "next"

import { TwoStepLoginSetup } from "@/components/auth/two-step-login-setup"

export const metadata: Metadata = { title: "Set up two-step verification" }

export default async function TwoStepSetupPage({ searchParams }: PageProps<"/login/two-step/setup">) {
  const next = (await searchParams).next
  return <TwoStepLoginSetup next={typeof next === "string" ? next : undefined} />
}
