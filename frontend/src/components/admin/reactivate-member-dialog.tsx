"use client"

import { useState } from "react"
import { Info, Mail, ScrollText, ShieldCheck } from "lucide-react"

import { FormField } from "@/components/auth/form-field"
import { PasswordInput } from "@/components/auth/password-input"
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
import { ApiError, fieldErrors } from "@/lib/api"
import { type Member, firstName, reactivateMember } from "@/lib/members"

/** UC-10.2, 1b: after re-authentication the access returns with the previous role. A suspension
 * of the whole account by a Sentra Platform Administrator can only be undone by them (1a). */
export function ReactivateMemberDialog({
  member,
  organization,
  onClose,
  onReactivated,
}: {
  member: Member | null
  organization: string
  onClose: () => void
  onReactivated: (member: Member) => void
}) {
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)

  function close(open: boolean) {
    if (open) return
    setPassword("")
    setErrors({})
    onClose()
  }

  if (!member) return null
  const who = firstName(member.name)

  if (member.suspended_by_platform) {
    return (
      <Dialog open onOpenChange={close}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{member.name} can&apos;t be reactivated here</DialogTitle>
            <DialogDescription>
              A Sentra Platform Administrator suspended {who}&apos;s whole account
              {member.suspension_reason ? `: ${member.suspension_reason}` : "."} Only they can reactivate it, and then{" "}
              {who} returns to {organization} with the role {member.role_label}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="h-9">
                Close
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  const consequences = [
    { icon: ShieldCheck, text: `${who} can open ${organization} again, with the role ${member.role_label}.` },
    { icon: Mail, text: `${who} is told by e-mail.` },
    { icon: ScrollText, text: "The reactivation is recorded in the audit log." },
  ]

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!member) return
    if (!password) {
      setErrors({ password: "Enter your password to confirm." })
      return
    }
    setPending(true)
    try {
      await reactivateMember(member.membership_id, password)
      onReactivated(member)
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
      <DialogContent className="sm:max-w-[560px]">
        <form onSubmit={submit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>Reactivate {member.name}?</DialogTitle>
            <DialogDescription>
              {member.suspended_by ? `Suspended by ${member.suspended_by}` : "Suspended"}
              {member.suspension_reason ? `. Reason: ${member.suspension_reason}` : "."}
            </DialogDescription>
          </DialogHeader>
          <section aria-labelledby="reactivate-what-happens">
            <h3 id="reactivate-what-happens" className="mb-2 text-sm font-semibold">
              What happens
            </h3>
            <ul className="space-y-2">
              {consequences.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-2.5 text-sm text-text-secondary">
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  {text}
                </li>
              ))}
            </ul>
          </section>
          <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {who} has to log in again; the sessions that ended with the suspension don&apos;t come back.
          </p>
          <FormField id="reactivate-password" label="Confirm with your password" error={errors.password}>
            <PasswordInput
              id="reactivate-password"
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
            <Button type="submit" className="h-9 hover:bg-primary-hover" disabled={pending}>
              {pending ? "Reactivating…" : "Reactivate member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
