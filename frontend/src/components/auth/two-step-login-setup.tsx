"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { AuthCard } from "@/components/auth/auth-card"
import { ConnectApp, SaveRecoveryCodes, StepIndicator } from "@/components/auth/two-step-setup"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ApiError, safeNextPath } from "@/lib/api"
import {
  type LoginResult,
  type MfaSetup,
  cancelLogin,
  enableAtLogin,
  pendingLogin,
  requiredByHeading,
  secondStepPath,
  startSetupAtLogin,
} from "@/lib/mfa"

/**
 * Screen 10 during a login: the organization requires two-step verification and the user has
 * not set it up (UC-1.2, 3b). The password was entered a moment ago, so it isn't asked again
 * (UC-1.4, 1a). "Log out" ends the login instead of "Cancel".
 */
export function TwoStepLoginSetup({ next }: { next?: string }) {
  const router = useRouter()
  const [login, setLogin] = useState<LoginResult | null>(null)
  const [setup, setSetup] = useState<MfaSetup | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [failed, setFailed] = useState(false)
  const codesHeading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    pendingLogin()
      .then(async (found) => {
        if (found.step !== "mfa_setup") {
          router.replace(secondStepPath(found.step, next))
          return
        }
        setLogin(found)
        setSetup(await startSetupAtLogin())
      })
      .catch((error) => {
        if (error instanceof ApiError && error.code === "login_expired") router.replace("/login?expired")
        else setFailed(true)
      })
  }, [router, next])

  useEffect(() => {
    if (codes) codesHeading.current?.focus()
  }, [codes])

  async function logOut() {
    await cancelLogin().catch(() => undefined)
    router.replace("/login")
  }

  async function verify(code: string) {
    try {
      setCodes((await enableAtLogin(code)).recovery_codes) // the session has started
    } catch (error) {
      if (error instanceof ApiError && error.code === "login_expired") router.replace("/login?expired")
      throw error
    }
  }

  const logOutButton = (
    <Button type="button" variant="ghost" className="h-9" onClick={logOut}>
      Log out
    </Button>
  )

  if (failed) {
    return (
      <AuthCard title="Set up two-step verification">
        <Alert variant="destructive" className="mb-5">
          <AlertDescription>The setup could not be started. Log in again to try once more.</AlertDescription>
        </Alert>
        <Button className="h-9 w-full hover:bg-primary-hover" onClick={logOut}>
          Back to login
        </Button>
      </AuthCard>
    )
  }

  if (!login || !setup) {
    return (
      <AuthCard title="Set up two-step verification">
        <p role="status" className="text-sm text-muted-foreground">
          Loading…
        </p>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title={requiredByHeading(login.required_by)}
      className="max-w-[560px]"
      description={
        <>
          From now on, every login to <span className="font-medium text-foreground">{login.email}</span> asks for a code
          from an authenticator app on your phone, in addition to your password.
        </>
      }
    >
      <StepIndicator steps={["Connect your app", "Save recovery codes"]} current={codes ? 1 : 0} />
      <div className="mt-6">
        {codes ? (
          <SaveRecoveryCodes
            codes={codes}
            email={login.email}
            finishLabel="Finish and continue"
            onFinish={() => router.replace(safeNextPath(next))}
            headingRef={codesHeading}
            level={2}
          />
        ) : (
          <ConnectApp setup={setup} onVerify={verify} secondary={logOutButton} level={2} />
        )}
      </div>
    </AuthCard>
  )
}
