import type { Metadata } from "next"

import { ConfirmEmail } from "@/components/auth/confirm-email"

export const metadata: Metadata = { title: "Confirm new e-mail address" }

export default async function ConfirmEmailPage({ searchParams }: PageProps<"/confirm-email">) {
  const { token } = await searchParams
  return <ConfirmEmail token={typeof token === "string" ? token : undefined} />
}
