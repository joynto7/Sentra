"use client"

import { useEffect, useState } from "react"
import { History, LogOut, Mail, ShieldCheck, UsersRound } from "lucide-react"

import { REASON_MAX, ReasonField } from "@/components/admin/reason-field"
import { FormField } from "@/components/auth/form-field"
import { PasswordInput } from "@/components/auth/password-input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError, fieldErrors } from "@/lib/api"
import { type Member, type SuspensionImpact, firstName, suspendMember, suspensionImpact } from "@/lib/members"
import { listNames } from "@/lib/platform"
import { initials } from "@/lib/session"

/** Screen 15, "Suspend member": UC-10.2. The consequences are listed before the administrator
 * confirms with their password (NFR-3.5); the destructive button is the only red element. */
export function SuspendMemberDialog({
  member,
  organization,
  onClose,
  onSuspended,
}: {
  member: Member | null
  organization: string
  onClose: () => void
  onSuspended: (member: Member) => void
}) {
  const [reason, setReason] = useState("")
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  // Kept with the member it belongs to, so another member never shows these consequences.
  const [loaded, setLoaded] = useState<{ id: string; impact: SuspensionImpact } | null>(null)

  useEffect(() => {
    if (!member) return
    let active = true
    const id = member.membership_id
    suspensionImpact(id)
      .then((found) => active && setLoaded({ id, impact: found }))
      // Without the details, the consequences are still listed, only without numbers.
      .catch(() => active && setLoaded({ id, impact: { member: member.name, sessions: -1, other_administrators: [] } }))
    return () => {
      active = false
    }
  }, [member])
  const impact = loaded && loaded.id === member?.membership_id ? loaded.impact : null

  function close(open: boolean) {
    if (open) return
    setReason("")
    setPassword("")
    setErrors({})
    onClose()
  }

  if (!member) return null
  const who = firstName(member.name)
  const sessions = impact?.sessions ?? -1
  const consequences = [
    {
      icon: LogOut,
      text:
        sessions > 0
          ? `${who} is logged out of ${organization} at once: ${sessions === 1 ? "1 open session ends" : `${sessions} open sessions end`}.`
          : `${who} loses access to ${organization} at once${sessions === 0 ? " (no session is open now)" : ""}.`,
    },
    { icon: ShieldCheck, text: `${who} keeps the role ${member.role_label}, so reactivating restores the same access.` },
    ...(impact && impact.other_administrators.length
      ? [{ icon: UsersRound, text: `The other administrators are informed: ${listNames(impact.other_administrators)}.` }]
      : []),
    { icon: Mail, text: `${who} is told by e-mail.` },
    { icon: History, text: `${who}'s past actions stay in the audit log and in the organization's history.` },
  ]

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!member) return
    const found: Record<string, string> = {}
    if (!reason.trim()) found.reason = "Enter the reason. It is recorded in the audit log."
    else if (reason.trim().length > REASON_MAX) found.reason = `Use at most ${REASON_MAX} characters.`
    if (!password) found.password = "Enter your password to confirm."
    setErrors(found)
    if (Object.keys(found).length) return
    setPending(true)
    try {
      await suspendMember(member.membership_id, reason.trim(), password)
      onSuspended(member)
      close(false)
    } catch (error) {
      const fields = fieldErrors(error)
      setErrors(Object.keys(fields).length ? fields : { form: error instanceof ApiError ? error.message : "Something went wrong. Try again." })
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={close}>
      <DialogContent className="sm:max-w-[600px]">
        <form onSubmit={submit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>Suspend {member.name}?</DialogTitle>
            <DialogDescription>
              Suspending blocks access to {organization} at once without removing {who}. You can reactivate {who} later.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3 rounded-[10px] border p-3">
            <Avatar className="size-9">
              <AvatarFallback className="text-xs font-medium">{initials(member.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 text-sm">
              <div className="truncate">{member.email}</div>
              <div className="text-muted-foreground">{member.role_label}</div>
            </div>
          </div>
          <ReasonField
            id="suspend-reason"
            value={reason}
            onChange={setReason}
            error={errors.reason}
            placeholder="For example: extended leave, access paused at the security manager's request"
          />
          <section aria-labelledby="suspend-what-happens" aria-busy={!impact}>
            <h3 id="suspend-what-happens" className="mb-2 text-sm font-semibold">
              What happens
            </h3>
            {impact ? (
              <ul className="space-y-2">
                {consequences.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-start gap-2.5 text-sm text-text-secondary">
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    {text}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="space-y-2" role="status" aria-label="Loading the consequences">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            )}
          </section>
          <FormField id="suspend-password" label="Confirm with your password" error={errors.password}>
            <PasswordInput
              id="suspend-password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              invalid={!!errors.password}
            />
          </FormField>
          {errors.form && (
            <p role="alert" className="text-sm text-destructive">
              {errors.form}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="h-9">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive" className="h-9" disabled={pending}>
              {pending ? "Suspending…" : "Suspend member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
