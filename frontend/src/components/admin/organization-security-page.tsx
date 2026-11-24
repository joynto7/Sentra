"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { AdminNav } from "@/components/admin/admin-nav"
import { SsoCard } from "@/components/admin/sso-card"
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
import { listCampaigns } from "@/lib/campaigns"

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
  // FR-5.2 (M5): the second setting of this page — campaigns need a Security Manager's approval
  const [approval, setApproval] = useState(false)
  const [approvalError, setApprovalError] = useState<string>()
  const [now, setNow] = useState(0)
  // The campaigns that wait for a decision now: turning the requirement off releases them
  const [waiting, setWaiting] = useState<string[] | null>(null)
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
        if (!keepSwitch) {
          setRequired(found.mfa_required)
          setApproval(found.requires_scope_approval)
        }
        setNow(Date.now())
        setFailed(false)
      })
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => {
    if (canManage) load()
  }, [canManage, load])

  useEffect(() => {
    if (!canManage) return
    listCampaigns()
      .then((rows) => setWaiting(rows.filter((one) => one.approval_status === "awaiting_approval").map((one) => one.code)))
      .catch(() => setWaiting(null))
  }, [canManage, security?.requires_scope_approval])

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
        description="Ask an Organization Administrator."
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
    const approvalChanged = approval !== security.requires_scope_approval
    const mfaChanged = required !== security.mfa_required
    setSaving(true)
    setApprovalError(undefined)
    try {
      const saved = await saveOrganizationSecurity(required, approval)
      setSecurity(saved)
      setRequired(saved.mfa_required)
      setApproval(saved.requires_scope_approval)
      if (approvalChanged) {
        toast.success(
          saved.requires_scope_approval
            ? "Campaigns now need a Security Manager's approval"
            : "Campaigns no longer need a Security Manager's approval",
          {
            description: saved.requires_scope_approval
              ? "A new campaign waits for a decision before it can run."
              : "Campaigns that were waiting can run again.",
          },
        )
      }
      if (!mfaChanged) return
      if (saved.mfa_required) {
        toast.success("Two-step verification is now required", {
          description: told ? `${told === 1 ? "1 member was" : `${told} members were`} told by e-mail.` : "Every member already uses it.",
        })
      } else {
        toast.success("Two-step verification is no longer required", { description: "Members can log in without it." })
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "no_security_manager") {
        // FR-5.2: without someone who could approve, no campaign could be launched again
        setApprovalError(error.message)
        setApproval(security.requires_scope_approval)
      } else if (error instanceof ApiError && error.code === "password_confirmation_required") {
        setSecurity({ ...security, password_confirmed_until: null }) // ask again; the switch stays
      } else {
        toast.error(error instanceof ApiError ? error.message : "The settings could not be saved. Try again.")
      }
    } finally {
      setSaving(false)
    }
  }

  const changed =
    !!security && (required !== security.mfa_required || approval !== security.requires_scope_approval)
  const without = security?.members_without_mfa ?? 0
  let helper: React.ReactNode = "Members can turn it on for their own account in Account › Security."
  const mfaChangedNow = !!security && required !== security.mfa_required
  if (security && mfaChangedNow && required) {
    helper = without
      ? `When you save, the ${without === 1 ? "member who hasn't" : `${without} members who haven't`} set it up ${without === 1 ? "is" : "are"} told by e-mail and asked to set it up at their next login.`
      : "When you save, every member must use it. All members have set it up already."
  } else if (security && mfaChangedNow) {
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
          <p className="mt-1 text-sm text-muted-foreground">
            How the members of {organization?.name} log in, and what a campaign needs before it runs.
          </p>
        </div>

        {security && (
          <p role="status" className="max-w-4xl rounded-[10px] border bg-muted/40 p-3 text-[13px]" aria-label="Active now">
            <span className="font-medium">Active now:</span> two-step verification{" "}
            {security.mfa_required ? "is required" : "is not required"} · scope approval {security.requires_scope_approval ? "is on" : "is off"} · single
            sign-on {security.sso.connected ? `is saved for @${security.sso.email_domain}` : "is not connected"}. A change below takes effect only after
            you save it.
          </p>
        )}

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
                You can change the settings for {minutes(until - now)} more. Changes on this page are recorded in the{" "}
                <Link href="/audit-log" className="font-medium text-link hover:underline">
                  audit log
                </Link>
                .
              </AlertDescription>
            </Alert>
            <div className="grid max-w-4xl items-start gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
              <div className="min-w-0 space-y-5">
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
                </section>

                {/* FR-5.2 (M5), optional: the organization may require a Security Manager to
                    approve a campaign's scope and budget before it can run (UC-5.2). */}
                <section
                  aria-labelledby="approval-setting-heading"
                  className="space-y-5 rounded-[10px] border bg-card p-6"
                >
                  <h2 id="approval-setting-heading" className="text-[15px] font-semibold">
                    Campaign scope approval
                  </h2>
                  <div className="flex items-start justify-between gap-6">
                    <div className="space-y-1.5">
                      <Label htmlFor="require-approval" className="text-sm font-medium">
                        Require a Security Manager to approve a campaign&apos;s scope
                      </Label>
                      <p id="require-approval-help" className="text-sm text-text-secondary" aria-live="polite">
                        {approval !== security.requires_scope_approval
                          ? approval
                            ? "When you save, a new campaign waits for a decision, and campaigns that were never submitted have to be submitted before they run."
                            : waiting === null
                            ? "When you save, the campaigns that are waiting can run again, without anyone's decision."
                            : waiting.length === 0
                              ? "No campaign is waiting for a decision now, so nothing is released by this."
                              : `When you save, the ${waiting.length === 1 ? "1 campaign that is" : `${waiting.length} campaigns that are`} waiting for a decision (${waiting.slice(0, 5).join(", ")}${waiting.length > 5 ? ", …" : ""}) can run without anyone's decision. A later decision is not asked for.`
                          : approval
                            ? "A campaign waits for a decision before it can run. Every decision is recorded with the manager who made it."
                            : "Campaigns run as soon as a Security Analyst launches them."}
                      </p>
                      <p className="text-sm text-text-secondary">
                        {security.security_managers === 0
                          ? "Nobody in this organization has the Security Manager role yet."
                          : `${security.security_managers === 1 ? "1 member" : `${security.security_managers} members`} can give that approval.`}{" "}
                        <Link
                          href="/admin/members"
                          className="font-medium text-link underline-offset-4 hover:underline"
                        >
                          View members
                        </Link>
                      </p>
                    </div>
                    <Switch
                      id="require-approval"
                      checked={approval}
                      onCheckedChange={(next) => {
                        setApproval(next)
                        setApprovalError(undefined)
                      }}
                      aria-describedby="require-approval-help"
                      className="mt-0.5"
                    />
                  </div>
                  {approvalError && (
                    <Alert variant="destructive" role="alert">
                      <AlertDescription>{approvalError}</AlertDescription>
                    </Alert>
                  )}
                </section>

                <div className="flex flex-wrap justify-end gap-2">
                  {changed && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9"
                      onClick={() => {
                        setRequired(security.mfa_required)
                        setApproval(security.requires_scope_approval)
                        setApprovalError(undefined)
                      }}
                    >
                      Undo changes
                    </Button>
                  )}
                  <Button type="button" className="h-9 hover:bg-primary-hover" disabled={!changed || saving} onClick={save}>
                    {saving ? "Saving…" : "Save settings"}
                  </Button>
                </div>
                <SsoCard
                  connection={security.sso}
                  onChange={(sso) => setSecurity((before) => (before ? { ...before, sso } : before))}
                />
              </div>
              <aside
                aria-labelledby="help-heading"
                className="space-y-2 rounded-[10px] border bg-muted/40 p-5 text-sm text-text-secondary"
              >
                <h2 id="help-heading" className="text-sm font-semibold text-foreground">
                  What does it change?
                </h2>
                <p>Members enter a 6-digit authenticator code after their password.</p>
                <p>Members without it are asked at their next login.</p>
                <p>A member who loses their phone logs in with one of their recovery codes.</p>
                <h2 id="sso-help-heading" className="pt-2 text-sm font-semibold text-foreground">
                  What does single sign-on change?
                </h2>
                <p>Members with this domain log in through your identity provider.</p>
                <p>They must still be invited first.</p>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
