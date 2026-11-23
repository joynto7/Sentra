import type { Metadata } from "next"

import { LoginForm } from "@/components/auth/login-form"
import { SSO_PROBLEMS } from "@/lib/sso"

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
  // A login that came back from the identity provider without a session says why (UC-1.5, 5a, 5b).
  const sso = typeof params.sso === "string" ? (SSO_PROBLEMS[params.sso] ?? SSO_PROBLEMS.failed) : undefined
  return (
    <LoginForm next={next} notice={noticeKey ? NOTICES[noticeKey] : undefined} problem={sso} />
  )
}
