"use client"

import { useRef, useState } from "react"
import { TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { NewRecoveryCodesDialog, SetUpTwoStepDialog } from "@/components/account/two-step-dialogs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { MfaStatus } from "@/lib/mfa"
import { formatDate } from "@/lib/test-library"

/**
 * Screen 09's "Two-step verification" card (FR-1.2): whether it is on, the recovery codes left,
 * and where UC-1.4 starts. An organization that requires it is named.
 */
export function TwoStepCard({ status, email, onChanged }: { status: MfaStatus; email: string; onChanged: () => void }) {
  const [settingUp, setSettingUp] = useState(false)
  const [renewing, setRenewing] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const required = status.required_by.length ? `Required by ${status.required_by.join(" and ")}` : null
  const left = status.recovery_codes_left

  function changed(message: string, description: string) {
    toast.success(message, { description })
    onChanged()
    // The button that opened the dialog may be gone, so the focus goes to the card's heading.
    requestAnimationFrame(() => heading.current?.focus())
  }

  return (
    <section aria-labelledby="mfa-heading" className="space-y-4 rounded-[10px] border bg-card p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="mfa-heading" ref={heading} tabIndex={-1} className="text-[15px] font-semibold outline-none">
          Two-step verification
        </h2>
        {status.enabled ? (
          <Badge variant="outline" className="border-success/60 font-normal text-success">
            On
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 border-warning/60 font-normal text-warning">
            <TriangleAlert aria-hidden="true" />
            Off
          </Badge>
        )}
      </div>

      {status.enabled ? (
        <>
          <p className="text-sm text-text-secondary">
            On · authenticator app · since {status.enabled_at ? formatDate(status.enabled_at) : "–"}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="tabular text-sm">
              Recovery codes: {left} of {status.recovery_codes_total} unused
            </p>
            <Button type="button" variant="outline" className="h-9" onClick={() => setRenewing(true)}>
              Generate new codes
            </Button>
          </div>
          {left <= 2 && (
            <p className="flex items-start gap-2 text-sm text-warning">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {left === 0
                ? "You have no recovery codes left. Generate new ones, so you can still log in if you lose your phone."
                : `Only ${left} recovery ${left === 1 ? "code is" : "codes are"} left. Generate new ones soon.`}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-text-secondary">
            Protect your account with a code from an authenticator app on your phone, in addition to your password.
          </p>
          <Button type="button" className="h-9 hover:bg-primary-hover" onClick={() => setSettingUp(true)}>
            Set up two-step verification
          </Button>
        </>
      )}

      {required && (
        <p className="text-xs text-muted-foreground">
          {required}.{!status.enabled && " You'll be asked to set it up at your next login."}
        </p>
      )}

      <SetUpTwoStepDialog
        open={settingUp}
        email={email}
        onOpenChange={setSettingUp}
        onEnabled={() => {
          setSettingUp(false)
          changed("Two-step verification is on", "Every login now asks for a code from your app.")
        }}
      />
      <NewRecoveryCodesDialog
        open={renewing}
        email={email}
        onOpenChange={setRenewing}
        onRenewed={() => {
          setRenewing(false)
          changed("New recovery codes generated", "The old codes no longer work.")
        }}
      />
    </section>
  )
}
