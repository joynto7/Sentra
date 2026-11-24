"use client"

import { useEffect, useState } from "react"
import { Minus, Plus } from "lucide-react"

import { FormField } from "@/components/auth/form-field"
import { PasswordInput } from "@/components/auth/password-input"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ApiError, fieldErrors } from "@/lib/api"
import { type Member, changeRole, firstName } from "@/lib/members"
import { type RoleInfo, loadRoles } from "@/lib/permissions"
import { initials } from "@/lib/session"
import { useSession } from "@/components/session-provider"

/** Screen 14: UC-10.1 Change Member Role. Shows what the member gains and loses (step 3). */
export function ChangeRoleDialog({
  member,
  onlyAdmin,
  onClose,
  onChanged,
}: {
  member: Member | null
  onlyAdmin: boolean
  onClose: () => void
  onChanged: (member: Member) => void
}) {
  const organization = useSession().organization?.name ?? "this organization"
  const [roles, setRoles] = useState<RoleInfo[]>([])
  const [role, setRole] = useState("")
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)

  useEffect(() => {
    loadRoles().then(setRoles).catch(() => undefined)
  }, [])

  function close(open: boolean) {
    if (open) return
    setRole("")
    setPassword("")
    setErrors({})
    onClose()
  }

  if (!member) return null
  const who = firstName(member.name)
  const current = roles.find((r) => r.role === member.role)
  const next = roles.find((r) => r.role === role)
  const have = new Set(current?.permissions.map((p) => p.action))
  const will = new Set(next?.permissions.map((p) => p.action))
  const gains = next?.permissions.filter((p) => !have.has(p.action)) ?? []
  const loses = current?.permissions.filter((p) => !will.has(p.action)) ?? []
  const keeps = current?.permissions.filter((p) => will.has(p.action)) ?? []

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!member || !role) return
    if (!password) {
      setErrors({ password: "Enter your password to confirm." })
      return
    }
    setPending(true)
    try {
      onChanged(await changeRole(member.membership_id, role, password))
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Change role for {member.name}</DialogTitle>
          <DialogDescription className="sr-only">Choose the new role and confirm with your password.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 rounded-[10px] border p-3">
          <Avatar className="size-9">
            <AvatarFallback className="text-xs font-medium">{initials(member.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 text-sm">
            <div className="truncate">{member.email}</div>
            <div className="text-muted-foreground">Current role: {member.role_label}</div>
          </div>
        </div>

        {onlyAdmin ? (
          <>
            <Alert role="status">
              <AlertDescription>
                {member.name} is the only Organization Administrator. Give another member this role first.
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" className="h-9">
                  Close
                </Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="new-role">New role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="new-role" className="h-9 w-full sm:w-72">
                  <SelectValue placeholder="Choose a role" />
                </SelectTrigger>
                <SelectContent>
                  {roles
                    .filter((r) => r.role !== member.role)
                    .map((r) => (
                      <SelectItem key={r.role} value={r.role}>
                        {r.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {next && (
              <div className="grid gap-4 sm:grid-cols-2" aria-live="polite">
                <section aria-labelledby="gains-heading">
                  <h3 id="gains-heading" className="mb-2 text-sm font-semibold">
                    {who} will gain
                  </h3>
                  <ul className="space-y-1.5 text-sm">
                    {gains.length ? (
                      gains.map((p) => (
                        <li key={p.action} className="flex items-start gap-2">
                          <Plus className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
                          {p.label}
                        </li>
                      ))
                    ) : (
                      <li className="text-muted-foreground">Nothing new</li>
                    )}
                  </ul>
                </section>
                <section aria-labelledby="loses-heading">
                  <h3 id="loses-heading" className="mb-2 text-sm font-semibold">
                    {who} will lose
                  </h3>
                  <ul className="space-y-1.5 text-sm">
                    {loses.length ? (
                      loses.map((p) => (
                        <li key={p.action} className="flex items-start gap-2">
                          <Minus className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden="true" />
                          {p.label}
                        </li>
                      ))
                    ) : (
                      <li className="text-muted-foreground">Nothing</li>
                    )}
                  </ul>
                </section>
                {keeps.length > 0 && (
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    {who} keeps: {keeps.map((p) => p.label).join(" · ")}.
                  </p>
                )}
              </div>
            )}

            <FormField id="confirm-password" label="Confirm with your password" error={errors.password}>
              <PasswordInput
                id="confirm-password"
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
            <p className="text-xs text-muted-foreground">
              This changes {who}&apos;s role in {organization} only. The new role applies from {who}&apos;s next request.
              {" "}{who} is told by e-mail, and the change is recorded in the audit log.
            </p>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" className="h-9">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" className="h-9 hover:bg-primary-hover" disabled={!role || pending}>
                {pending ? "Changing role…" : "Change role"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
