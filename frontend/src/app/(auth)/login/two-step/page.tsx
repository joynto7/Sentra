import type { Metadata } from "next"

import { TwoStepForm } from "@/components/auth/two-step-form"

export const metadata: Metadata = { title: "Two-step verification" }

export default async function TwoStepPage({ searchParams }: PageProps<"/login/two-step">) {
  const next = (await searchParams).next
  return <TwoStepForm next={typeof next === "string" ? next : undefined} />
}
