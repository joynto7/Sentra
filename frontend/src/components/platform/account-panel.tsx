"use client"

import { useState } from "react"
import { History, LogOut, Mail, ScrollText, ShieldCheck, UsersRound } from "lucide-react"

import { REASON_MAX, ReasonField } from "@/components/admin/reason-field"
import { FormField } from "@/components/auth/form-field"
import { PasswordInput } from "@/components/auth/password-input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ApiError, fieldErrors } from "@/lib/api"
import { firstName } from "@/lib/members"
import { type Account, listNames, reactivateAccount, suspendAccount } from "@/lib/platform"
import { initials } from "@/lib/session"

/**
 * Screen 64, side panel: suspend an account in every organization at once (UC-10.2, 1a), or
 * reactivate it (1b). The platform-wide effect is listed before the Platform Administrator
 * confirms with their password (NFR-3.5).
 */
export function AccountPanel({
  account,
  onClose,
  onDone,
}: {
  account: Account | null
  onClose: () => void
  onDone: (account: Account, action: "suspended" | "reactivated") => void
}) {
  const [reason, setReason] = useState("")
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)

  function close() {
    setReason("")
    setPassword("")
    setErrors({})
    onClose()
  }

  const suspending = account?.status !== "suspended"
  const who = account ? firstName(account.name) : ""
  const organizations = account?.organizations.map((o) => o.name) ?? []
  const count = organizations.length
  const consequences = suspending
    ? [
        {
          icon: LogOut,
          text:
            count > 0
              ? `${who} is logged out at once and can't open ${count === 1 ? "their organization" : `any of their ${count} organizations`}, or log in at all.`
              : `${who} is logged out at once and can't log in.`,
        },
        ...(count > 0
          ? [{ icon: UsersRound, text: `The Organization Administrators of ${listNames(organizations)} are informed.` }]
          : []),
        { icon: Mail, text: `${who} is told by e-mail, with the reason.` },
        { icon: History, text: `${who}'s roles and history stay, so the account can be reactivated later.` },
        { icon: ScrollText, text: "Recorded in the platform audit log and in each organization's audit log." },
      ]
    : [
        { icon: ShieldCheck, text: `${who} can log in again.` },
        {
          icon: UsersRound,
          text: "The memberships the platform suspended return with their previous roles. A suspension that an organization made itself stays.",
        },
        { icon: Mail, text: `${who} is told by e-mail.` },
        { icon: ScrollText, text: "Recorded in the platform audit log." },
      ]

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!account) return
    const found: Record<string, string> = {}
    if (suspending && !reason.trim()) found.reason = "Enter the reason. It is recorded in the audit log."
    else if (suspending && reason.trim().length > REASON_MAX) found.reason = `Use at most ${REASON_MAX} characters.`
    if (!password) found.password = "Enter your password to confirm."
    setErrors(found)
    if (Object.keys(found).length) return
    setPending(true)
    try {
      const changed = suspending
        ? await suspendAccount(account.id, reason.trim(), password)
        : await reactivateAccount(account.id, password)
      onDone(changed, suspending ? "suspended" : "reactivated")
      close()
    } catch (error) {
      const fields = fieldErrors(error)
      setErrors(Object.keys(fields).length ? fields : { form: error instanceof ApiError ? error.message : "Something went wrong. Try again." })
    } finally {
      setPending(false)
    }
  }

  return (
    <Sheet open={!!account} onOpenChange={(open) => !open && close()}>
      <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-[520px]">
        {account && (
          <form onSubmit={submit} noValidate className="flex min-h-full flex-col">
            <SheetHeader className="border-b px-6 py-4 pr-12">
              <SheetTitle className="text-base font-semibold">
                {suspending ? "Suspend account in all organizations" : "Reactivate account"}
              </SheetTitle>
              <SheetDescription>
                {suspending
                  ? "For security or support reasons, such as an account that may be compromised."
                  : `${account.name}'s account was suspended${account.suspension_reason ? `: ${account.suspension_reason}` : "."}`}
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-5 px-6 py-5">
              <div className="flex items-center gap-3 rounded-[10px] border p-3">
                <Avatar className="size-9">
                  <AvatarFallback className="text-xs font-medium">{initials(account.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 text-sm">
                  <div className="truncate font-medium">{account.name}</div>
                  <div className="truncate text-muted-foreground">{account.email}</div>
                  <div className="text-muted-foreground">
                    {count ? `${count} ${count === 1 ? "organization" : "organizations"}: ${listNames(organizations)}` : "No organization"}
                  </div>
                </div>
              </div>
              {suspending && (
                <ReasonField
                  id="account-reason"
                  value={reason}
                  onChange={setReason}
                  error={errors.reason}
                  placeholder="For example: logins from an unexpected country; the account may be compromised"
                />
              )}
              <section aria-labelledby="account-consequences">
                <h3 id="account-consequences" className="mb-2 text-sm font-semibold">
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
              <FormField id="account-password" label="Confirm with your password" error={errors.password}>
                <PasswordInput
                  id="account-password"
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
            </div>
            <SheetFooter className="flex-row justify-end gap-2 border-t px-6 py-4">
              <Button type="button" variant="outline" className="h-9" onClick={close}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant={suspending ? "destructive" : "default"}
                className={suspending ? "h-9" : "h-9 hover:bg-primary-hover"}
                disabled={pending}
              >
                {pending ? (suspending ? "Suspending…" : "Reactivating…") : suspending ? "Suspend account" : "Reactivate account"}
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  )
}
