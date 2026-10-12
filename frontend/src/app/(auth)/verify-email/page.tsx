import type { Metadata } from "next"

import { VerifyEmail } from "@/components/auth/verify-email"

export const metadata: Metadata = { title: "Confirm e-mail" }

export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const { token } = await searchParams
  return <VerifyEmail token={typeof token === "string" ? token : undefined} />
}
