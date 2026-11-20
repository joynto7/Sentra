import type { Metadata } from "next"

import { LoginForm } from "@/components/auth/login-form"

export const metadata: Metadata = { title: "Log in" }

const NOTICES: Record<string, string> = {
  verified: "Your e-mail address is confirmed. You can log in now.",
  reset: "Your password was changed. Log in with the new password.",
  expired: "Your login has expired. Log in again.",
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams
  const next = typeof params.next === "string" ? params.next : undefined
  const noticeKey = Object.keys(NOTICES).find((key) => params[key] !== undefined)
  return <LoginForm next={next} notice={noticeKey ? NOTICES[noticeKey] : undefined} />
}
