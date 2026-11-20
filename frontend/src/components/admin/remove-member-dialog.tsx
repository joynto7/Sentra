"use client"

import { useState } from "react"
import { History, LogOut, Mail, UserRoundX } from "lucide-react"

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
import { ApiError, fieldErrors } from "@/lib/api"
import { type Member, firstName, removeMember } from "@/lib/members"
import { initials } from "@/lib/session"

/** Screen 15, "Remove member": UC-1.10. The consequences are listed before confirming. */
export function RemoveMemberDialog({
  member,
  organization,
  onClose,
  onRemoved,
}: {
  member: Member | null
  organization: string
  onClose: () => void
  onRemoved: (member: Member) => void
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
  const consequences = [
    { icon: LogOut, text: `${who} loses access to ${organization} at once and is logged out of it.` },
    { icon: History, text: `${who}'s past actions stay in the organization's history.` },
    { icon: Mail, text: `${who} is told by e-mail.` },
    { icon: UserRoundX, text: `${who} keeps their Sentra account and could join again only with a new invitation.` },
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
      await removeMember(member.membership_id, password)
      onRemoved(member)
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
            <DialogTitle>
              Remove {member.name} from {organization}?
            </DialogTitle>
            <DialogDescription>Removal is permanent.</DialogDescription>
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
          <section aria-labelledby="what-happens">
            <h3 id="what-happens" className="mb-2 text-sm font-semibold">
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
          <FormField id="remove-password" label="Confirm with your password" error={errors.password}>
            <PasswordInput
              id="remove-password"
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
              {pending ? "Removing…" : "Remove member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
