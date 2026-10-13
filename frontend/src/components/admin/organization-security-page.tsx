"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { AdminNav } from "@/components/admin/admin-nav"
import { FormField } from "@/components/auth/form-field"
import { PasswordInput } from "@/components/auth/password-input"
import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { useSession } from "@/components/session-provider"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { ApiError, fieldErrors } from "@/lib/api"
import {
  type OrganizationSecurity,
  confirmPassword,
  membersWithout,
  organizationSecurity,
  saveOrganizationSecurity,
} from "@/lib/mfa"
import { useCan } from "@/lib/permissions"

const MINUTE = 60_000

function minutes(ms: number): string {
  const n = Math.max(1, Math.round(ms / MINUTE))
  return n === 1 ? "1 minute" : `${n} minutes`
}

/**
 * Screen 11: UC-1.7 Configure Organization Security, for Organization Administrators. The
 * password comes first (step 2); then requiring two-step verification (steps 3, 6 and 7; 3a).
 * Single sign-on joins this page with FR-1.3 (M1).
 */
export function OrganizationSecurityPage() {
  usePageCrumbs([{ label: "Organization Security" }])
  const organization = useSession().organization
  const canManage = useCan("manage_organization_security")
  const [security, setSecurity] = useState<OrganizationSecurity | null>(null)
  const [failed, setFailed] = useState(false)
  const [required, setRequired] = useState(false) // the switch, saved or not
  const [now, setNow] = useState(0)
  const [password, setPassword] = useState("")
  const [passwordError, setPasswordError] = useState<string>()
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const settingsHeading = useRef<HTMLHeadingElement>(null)
  const moveFocus = useRef(false)

  const load = useCallback((keepSwitch = false) => {
    organizationSecurity()
      .then((found) => {
        setSecurity(found)
        if (!keepSwitch) setRequired(found.mfa_required)
        setNow(Date.now())
        setFailed(false)
      })
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => {
    if (canManage) load()
  }, [canManage, load])

  // "N minutes ago" stays right, and the page notices when the confirmation runs out.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])

  const until = security?.password_confirmed_until ? Date.parse(security.password_confirmed_until) : 0
  const confirmed = !!security && now > 0 && until > now

  useEffect(() => {
    if (confirmed && moveFocus.current) {
      moveFocus.current = false
      settingsHeading.current?.focus()
    }
  }, [confirmed])

  if (canManage === false) {
    return (
      <EmptyState
        title="Only Organization Administrators change organization security"
        description="Ask an Organization Administrator of your organization if a setting should change."
      />
    )
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault()
    if (!password) {
      setPasswordError("Enter your password.")
      document.getElementById("confirm-password")?.focus()
      return
    }
    setConfirming(true)
    setPasswordError(undefined)
    try {
      await confirmPassword(password)
      setPassword("")
      moveFocus.current = true
      load(true) // an unsaved switch stays as it was
    } catch (error) {
      setPasswordError(fieldErrors(error).password ?? (error instanceof ApiError ? error.message : "Something went wrong. Try again."))
      document.getElementById("confirm-password")?.focus()
    } finally {
      setConfirming(false)
    }
  }

  async function save() {
    if (!security) return
    const told = security.members_without_mfa
    setSaving(true)
    try {
      const saved = await saveOrganizationSecurity(required)
      setSecurity(saved)
      setRequired(saved.mfa_required)
      if (saved.mfa_required) {
        toast.success("Two-step verification is now required", {
          description: told ? `${told === 1 ? "1 member was" : `${told} members were`} told by e-mail.` : "Every member already uses it.",
        })
      } else {
        toast.success("Two-step verification is no longer required", { description: "Members can log in without it." })
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "password_confirmation_required") {
        setSecurity({ ...security, password_confirmed_until: null }) // ask again; the switch stays
      } else {
        toast.error(error instanceof ApiError ? error.message : "The settings could not be saved. Try again.")
      }
    } finally {
      setSaving(false)
    }
  }

  const changed = !!security && required !== security.mfa_required
  const without = security?.members_without_mfa ?? 0
  let helper: React.ReactNode = "Members can turn it on for their own account in Account › Security."
  if (security && changed && required) {
    helper = without
      ? `When you save, the ${without === 1 ? "member who hasn't" : `${without} members who haven't`} set it up ${without === 1 ? "is" : "are"} told by e-mail and asked to set it up at their next login.`
      : "When you save, every member must use it. All members have set it up already."
  } else if (security && changed) {
    helper = "When you save, members can log in without it again. Members who set it up keep using it."
  } else if (security?.mfa_required) {
    helper = without ? `${membersWithout(without)} set it up yet. They'll be asked to at their next login.` : "Every member has set it up."
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <AdminNav />
      <div className="min-w-0 flex-1 space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Organization Security</h1>
          <p className="mt-1 text-sm text-muted-foreground">How the members of {organization?.name} log in.</p>
        </div>

        {failed && (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-4">
              The security settings could not be loaded.
              <Button variant="outline" size="sm" onClick={() => load()}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {!security || canManage === undefined || now === 0 ? (
          !failed && (
            <div className="space-y-3" role="status" aria-label="Loading the security settings">
              <Skeleton className="h-40 w-full max-w-2xl" />
            </div>
          )
        ) : !confirmed ? (
          <section aria-labelledby="confirm-heading" className="max-w-lg space-y-4 rounded-[10px] border bg-card p-6">
            <h2 id="confirm-heading" className="text-[15px] font-semibold">
              Confirm your password
            </h2>
            <p className="text-sm text-text-secondary">
              {security.password_confirmed_at
                ? "Your password confirmation has run out. Enter your password again to change the settings."
                : "Changing how members log in needs your password again. It stays confirmed for 10 minutes."}
              {changed && " Your unsaved change is kept."}
            </p>
            <form onSubmit={confirm} noValidate className="space-y-4">
              <FormField id="confirm-password" label="Password" error={passwordError} announce>
                <PasswordInput
                  id="confirm-password"
                  value={password}
                  onChange={setPassword}
                  autoComplete="current-password"
                  invalid={!!passwordError}
                />
              </FormField>
              <Button type="submit" className="h-9 hover:bg-primary-hover" disabled={confirming}>
                {confirming ? "Confirming…" : "Confirm password"}
              </Button>
            </form>
          </section>
        ) : (
          <>
            <Alert role="status" className="max-w-4xl">
              <ShieldCheck aria-hidden="true" />
              <AlertDescription className="text-text-secondary">
                You confirmed your password {now - Date.parse(security.password_confirmed_at ?? "") < MINUTE ? "just now" : `${minutes(now - Date.parse(security.password_confirmed_at ?? ""))} ago`}.
                You can change the settings for {minutes(until - now)} more.
              </AlertDescription>
            </Alert>
            <div className="grid max-w-4xl items-start gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
              <section aria-labelledby="mfa-setting-heading" className="space-y-5 rounded-[10px] border bg-card p-6">
                <h2 id="mfa-setting-heading" ref={settingsHeading} tabIndex={-1} className="text-[15px] font-semibold outline-none">
                  Two-step verification
                </h2>
                <div className="flex items-start justify-between gap-6">
                  <div className="space-y-1.5">
                    <Label htmlFor="require-mfa" className="text-sm font-medium">
                      Require two-step verification for all members
                    </Label>
                    <p id="require-mfa-help" className="text-sm text-text-secondary" aria-live="polite">
                      {helper}
                    </p>
                    {security.mfa_required && !changed && without > 0 && (
                      <Link href="/admin/members?mfa=off" className="inline-block text-sm font-medium text-link underline-offset-4 hover:underline">
                        View members
                      </Link>
                    )}
                  </div>
                  <Switch id="require-mfa" checked={required} onCheckedChange={setRequired} aria-describedby="require-mfa-help" className="mt-0.5" />
                </div>
                <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                  {changed && (
                    <Button type="button" variant="outline" className="h-9" onClick={() => setRequired(security.mfa_required)}>
                      Undo change
                    </Button>
                  )}
                  <Button type="button" className="h-9 hover:bg-primary-hover" disabled={!changed || saving} onClick={save}>
                    {saving ? "Saving…" : "Save settings"}
                  </Button>
                </div>
              </section>
              <aside aria-labelledby="help-heading" className="space-y-2 rounded-[10px] border bg-muted/40 p-5 text-sm text-text-secondary">
                <h2 id="help-heading" className="text-sm font-semibold text-foreground">
                  What does it change?
                </h2>
                <p>After their password, members enter a 6-digit code from an authenticator app on their phone, so a stolen password alone is not enough to log in.</p>
                <p>Members who haven&apos;t set it up are asked to at their next login. Sessions that are open now continue until they end.</p>
                <p>A member who loses their phone logs in with one of their recovery codes.</p>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
