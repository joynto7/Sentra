"use client"

import { useEffect, useState } from "react"
import { Info } from "lucide-react"

import { FormField } from "@/components/auth/form-field"
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
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ApiError, fieldErrors } from "@/lib/api"
import { type Invitation, invite } from "@/lib/members"
import { type RoleInfo, loadRoles } from "@/lib/permissions"
import { cn } from "@/lib/utils"

/** Screen 13: UC-1.8 Invite Team Member. */
export function InviteDialog({
  open,
  onOpenChange,
  onInvited,
  initialRole = "",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInvited: (invitation: Invitation) => void
  /** A role chosen in advance, e.g. "Invite a developer" on Getting started (Screen 07) */
  initialRole?: string
}) {
  const [roles, setRoles] = useState<RoleInfo[]>([])
  const [email, setEmail] = useState("")
  const [role, setRole] = useState(initialRole)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)

  useEffect(() => {
    loadRoles().then(setRoles).catch(() => undefined)
  }, [])

  function reset(next: boolean) {
    if (!next) {
      setEmail("")
      setRole(initialRole)
      setErrors({})
    }
    onOpenChange(next)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const found: Record<string, string> = {}
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) found.email = "Enter a work e-mail address, such as name@company.com."
    if (!role) found.role = "Choose a role."
    setErrors(found)
    if (Object.keys(found).length) return
    setPending(true)
    try {
      const invitation = await invite(email.trim(), role)
      onInvited(invitation)
      reset(false)
    } catch (error) {
      const fields = fieldErrors(error)
      setErrors(Object.keys(fields).length ? fields : { form: error instanceof ApiError ? error.message : "Something went wrong. Try again." })
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="sm:max-w-[560px]">
        <form onSubmit={submit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>Invite member</DialogTitle>
            <DialogDescription>They get an e-mail with a link to join your organization.</DialogDescription>
          </DialogHeader>
          <FormField id="invite-email" label="Work e-mail" error={errors.email}>
            <Input
              id="invite-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!errors.email || undefined}
              aria-describedby={errors.email ? "invite-email-error" : undefined}
              className="h-9"
            />
          </FormField>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Role</legend>
            <RadioGroup value={role} onValueChange={setRole} aria-describedby={errors.role ? "invite-role-error" : undefined} className="grid gap-2">
              {roles.map((r) => (
                <label
                  key={r.role}
                  htmlFor={`invite-role-${r.role}`}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-[10px] border bg-card p-3 hover:border-border-strong",
                    role === r.role && "border-primary bg-accent/60 ring-1 ring-primary",
                  )}
                >
                  <RadioGroupItem id={`invite-role-${r.role}`} value={r.role} className="mt-0.5" aria-describedby={`invite-role-${r.role}-description`} />
                  <span>
                    <span className="block text-sm font-semibold">{r.label}</span>
                    <span id={`invite-role-${r.role}-description`} className="block text-xs text-muted-foreground">
                      {r.description}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
            {errors.role && (
              <p id="invite-role-error" className="text-xs text-destructive">
                {errors.role}
              </p>
            )}
          </fieldset>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            The invitation link works once, only for this e-mail address, and expires in 7 days.
          </p>
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
              {pending ? "Sending…" : "Send invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
