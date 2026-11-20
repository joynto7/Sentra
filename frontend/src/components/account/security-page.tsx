"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { AccountNav } from "@/components/account/account-nav"
import { FormField } from "@/components/auth/form-field"
import { PasswordChecklist } from "@/components/auth/password-checklist"
import { PasswordInput } from "@/components/auth/password-input"
import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { useSession } from "@/components/session-provider"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  type AccountEvent,
  EVENT_LABEL,
  type Profile,
  type SessionInfo,
  changePassword,
  dateTime,
  describeAgent,
  endOtherSessions,
  endSession,
  getProfile,
  listSessions,
  recentActivity,
} from "@/lib/account"
import { ApiError } from "@/lib/api"
import { formatDate } from "@/lib/test-library"

function Card({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-4 rounded-[10px] border bg-card p-6">
      <h2 id={id} className="text-[15px] font-semibold">
        {title}
      </h2>
      {children}
    </section>
  )
}

/** Screen 09: UC-1.11 steps 4-7 (alternatives 4a, 5a): password, active sessions, recent activity. */
export function SecurityPage() {
  const email = useSession().email
  const [profile, setProfile] = useState<Profile | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null)
  const [activity, setActivity] = useState<AccountEvent[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [changing, setChanging] = useState(false)
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const changeButton = useRef<HTMLButtonElement>(null)
  const sessionsHeading = useRef<HTMLHeadingElement>(null)

  usePageCrumbs([{ label: "Account", href: "/account/profile" }, { label: "Security" }])

  const load = useCallback(() => {
    Promise.all([getProfile(), listSessions(), recentActivity()])
      .then(([loadedProfile, loadedSessions, loadedActivity]) => {
        setProfile(loadedProfile)
        setSessions(loadedSessions)
        setActivity(loadedActivity)
      })
      .catch(() => setFailed(true))
  }, [])
  useEffect(load, [load])

  useEffect(() => {
    if (changing) document.getElementById("current-password")?.focus()
  }, [changing])

  function closeChange() {
    setChanging(false)
    setCurrent("")
    setNext("")
    setConfirm("")
    setErrors({})
    requestAnimationFrame(() => changeButton.current?.focus())
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault()
    const found: Record<string, string> = {}
    if (!current) found.current_password = "Enter your current password."
    if (!next) found.new_password = "Choose a new password."
    else if (next !== confirm) found.confirm = "The two new passwords are not the same."
    setErrors(found)
    if (Object.keys(found).length) {
      document.getElementById(found.current_password ? "current-password" : found.new_password ? "new-password" : "confirm-password")?.focus()
      return
    }
    setSaving(true)
    try {
      await changePassword(current, next)
      toast.success("Password changed", { description: "Your other sessions were logged out." })
      closeChange()
      load()
    } catch (error) {
      const fields: Record<string, string> = {}
      for (const detail of error instanceof ApiError ? (error.details ?? []) : []) fields[detail.field] = detail.message
      setErrors(Object.keys(fields).length ? fields : { form: error instanceof ApiError ? error.message : "Something went wrong. Try again." })
      document.getElementById(fields.current_password ? "current-password" : "new-password")?.focus()
    } finally {
      setSaving(false)
    }
  }

  async function logOut(session: SessionInfo) {
    try {
      await endSession(session.id)
      toast.success(`${describeAgent(session.user_agent)} was logged out`)
    } catch {
      toast.error("The session could not be logged out. Try again.")
    }
    load()
    requestAnimationFrame(() => sessionsHeading.current?.focus()) // the row and its button are gone
  }

  async function logOutOthers() {
    try {
      toast.success((await endOtherSessions()).message)
    } catch {
      toast.error("The sessions could not be logged out. Try again.")
    }
    load()
  }

  if (failed) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>Your security settings could not be loaded. Reload the page to try again.</AlertDescription>
      </Alert>
    )
  }

  const others = sessions?.filter((s) => !s.current) ?? []

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <AccountNav />
      <div className="min-w-0 flex-1 space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your password, where you are logged in, and what happened recently.</p>
        </div>

        {!profile || !sessions || !activity ? (
          <div className="space-y-3" role="status" aria-label="Loading your security settings">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-56 w-full" />
          </div>
        ) : (
          <>
            <Card id="password-heading" title="Password">
              <p className="text-sm text-text-secondary">
                Last changed {profile.password_changed_at ? formatDate(profile.password_changed_at) : formatDate(profile.created_at)}
              </p>
              {changing ? (
                <form onSubmit={savePassword} noValidate className="max-w-md space-y-4">
                  {errors.form && (
                    <Alert variant="destructive" role="alert">
                      <AlertDescription>{errors.form}</AlertDescription>
                    </Alert>
                  )}
                  <FormField id="current-password" label="Current password" error={errors.current_password}>
                    <PasswordInput
                      id="current-password"
                      value={current}
                      onChange={setCurrent}
                      autoComplete="current-password"
                      invalid={!!errors.current_password}
                    />
                  </FormField>
                  <FormField id="new-password" label="New password" error={errors.new_password}>
                    <PasswordInput id="new-password" value={next} onChange={setNext} autoComplete="new-password" invalid={!!errors.new_password} />
                    <PasswordChecklist password={next} email={email} serverError={errors.new_password} />
                  </FormField>
                  <FormField id="confirm-password" label="Confirm new password" error={errors.confirm}>
                    <PasswordInput id="confirm-password" value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={!!errors.confirm} />
                  </FormField>
                  <p className="text-xs text-muted-foreground">Changing your password logs you out of all other sessions.</p>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" className="h-9" onClick={closeChange}>
                      Cancel
                    </Button>
                    <Button type="submit" className="h-9 hover:bg-primary-hover" disabled={saving}>
                      {saving ? "Changing…" : "Change password"}
                    </Button>
                  </div>
                </form>
              ) : (
                <Button ref={changeButton} type="button" variant="outline" className="h-9" onClick={() => setChanging(true)}>
                  Change password
                </Button>
              )}
            </Card>

            <section aria-labelledby="sessions-heading" className="@container space-y-4 rounded-[10px] border bg-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="sessions-heading" ref={sessionsHeading} tabIndex={-1} className="text-[15px] font-semibold outline-none">
                  Active sessions
                </h2>
                {others.length > 0 && (
                  <Button type="button" variant="outline" className="h-9" onClick={logOutOthers}>
                    Log out of all other sessions
                  </Button>
                )}
              </div>
              <Table>
                <TableHeader className="bg-muted">
                  <TableRow>
                    <TableHead className="text-xs">Device and browser</TableHead>
                    <TableHead className="hidden text-xs @2xl:table-cell">IP address</TableHead>
                    <TableHead className="hidden text-xs @3xl:table-cell">Logged in</TableHead>
                    <TableHead className="text-xs">Last active</TableHead>
                    <TableHead className="w-24 text-xs">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell className="whitespace-normal">
                        <span className="text-[13px] font-medium">{describeAgent(session.user_agent)}</span>
                        {session.current && (
                          <Badge variant="secondary" className="ml-2 font-normal">
                            This device
                          </Badge>
                        )}
                        <div className="font-mono text-xs text-muted-foreground @2xl:hidden">{session.ip_address ?? "–"}</div>
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs @2xl:table-cell">{session.ip_address ?? "–"}</TableCell>
                      <TableCell className="hidden text-[13px] @3xl:table-cell">{dateTime(session.created_at)}</TableCell>
                      <TableCell className="text-[13px]">{session.current ? "Now" : dateTime(session.last_seen_at)}</TableCell>
                      <TableCell className="text-right">
                        {!session.current && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8"
                            aria-label={`Log out ${describeAgent(session.user_agent)}, ${session.ip_address ?? "unknown address"}`}
                            onClick={() => logOut(session)}
                          >
                            Log out
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">Don&apos;t recognize a session? Log it out and change your password.</p>
            </section>

            <Card id="activity-heading" title="Recent activity">
              {activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing yet.</p>
              ) : (
                <ul className="divide-y">
                  {activity.map((event, i) => (
                    <li key={`${event.created_at}-${i}`} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-2 text-sm">
                      <span className="w-44 shrink-0 text-muted-foreground">{dateTime(event.created_at)}</span>
                      <span className="min-w-0 flex-1">{EVENT_LABEL[event.kind] ?? event.kind}</span>
                      <span className="font-mono text-xs text-muted-foreground">{event.ip_address ?? ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
