"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowRight, LockKeyhole, MailOpen, UserCog } from "lucide-react"
import { toast } from "sonner"

import { FormField } from "@/components/auth/form-field"
import { useSession } from "@/components/session-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ApiError, apiFetch, fieldErrors } from "@/lib/api"
import { type MyInvitation, listMyInvitations } from "@/lib/members"

const POINTS = [
  { icon: UserCog, text: "You'll be the Organization Administrator." },
  { icon: LockKeyhole, text: "Your organization's data is isolated from every other organization." },
  { icon: ArrowRight, text: "Next: invite your team and register your first target." },
]

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" })

/**
 * Screen 06, UC-1.6 Create Organization. Someone who has no workspace yet is first shown the two ways
 * in, joining the organization that invited them or creating their own, so an invitation is never
 * answered by creating an organization by mistake. Someone who already works in an organization is
 * only creating another one, and can go back.
 */
export function CreateOrganizationForm() {
  const router = useRouter()
  const session = useSession()
  const hasWorkspace = session.organization !== null
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // Invitations sent to this person's own address; null while asking
  const [waiting, setWaiting] = useState<MyInvitation[] | null>(null)

  useEffect(() => {
    if (hasWorkspace) return
    let current = true
    listMyInvitations()
      .then((found) => current && setWaiting(found))
      .catch(() => current && setWaiting([]))
    return () => {
      current = false
    }
  }, [hasWorkspace])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return
    if (!name.trim()) {
      setError("Enter an organization name.")
      return
    }
    setPending(true)
    setError(null)
    try {
      await apiFetch("/v1/organizations", { method: "POST", body: JSON.stringify({ name }) })
      // Said after the server created it. UC-1.6 step 6: the new workspace opens with its first steps (Screen 07).
      toast.success(`${name.trim()} was created`, { description: "You are its Organization Administrator. Its first steps are next." })
      router.replace("/getting-started")
    } catch (err) {
      setError(fieldErrors(err).name ?? (err instanceof ApiError ? err.message : "Something went wrong. Try again."))
      setPending(false)
    }
  }

  return (
    <div className="w-full max-w-[480px] space-y-5">
      {!hasWorkspace && (
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">Join or create an organization</h1>
          <p className="text-sm text-muted-foreground">Sentra works inside an organization. Join the one that invited you, or create your own.</p>
        </div>
      )}

      {!hasWorkspace && (
        <section aria-labelledby="join-heading" className="rounded-[10px] border bg-card p-6">
          <h2 id="join-heading" className="flex items-center gap-2 text-[15px] font-semibold">
            <MailOpen className="size-4 text-muted-foreground" aria-hidden="true" />
            Join an organization you were invited to
          </h2>
          {waiting && waiting.length > 0 ? (
            <div className="mt-2 space-y-2 text-sm" role="status">
              <p>
                {waiting.length === 1 ? "An invitation is" : `${waiting.length} invitations are`} waiting for {session.email}:
              </p>
              <ul className="space-y-1">
                {waiting.map((one) => (
                  <li key={`${one.organization}-${one.expires_at}`} className="rounded-md border bg-muted/50 px-3 py-2">
                    <span className="font-medium">{one.organization}</span>, as {/^[AEIOU]/.test(one.role_label) ? "an" : "a"} {one.role_label}
                    {one.invited_by ? `, invited by ${one.invited_by}` : ""}. Open until {DAY.format(new Date(one.expires_at))}.
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground">
                Open the link in the e-mail we sent to {session.email} and accept it there. Sentra can&apos;t open it for you, because the link only travels in that e-mail.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-text-secondary">
              An invitation arrives as an e-mail with a link, sent to {session.email}. Open it to join, there is nothing to do here first. If you expect one and it has not
              come, ask your Organization Administrator to invite {session.email}.
            </p>
          )}
        </section>
      )}

      <section aria-labelledby="create-heading" className="rounded-[10px] border bg-card p-8">
        {hasWorkspace ? (
          <h1 id="create-heading" className="text-xl font-semibold tracking-tight">
            Create your organization
          </h1>
        ) : (
          <h2 id="create-heading" className="text-[15px] font-semibold">
            Create a new organization
          </h2>
        )}
        <p className="mt-1.5 text-sm text-muted-foreground">
          An organization is your team&apos;s private workspace for targets, campaigns, findings and reports.
        </p>
        <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
          <FormField id="name" label="Organization name" error={error ?? undefined}>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="organization"
              aria-invalid={!!error || undefined}
              aria-describedby={error ? "name-error" : "name-help"}
              className="h-9"
            />
            {!error && (
              <p id="name-help" className="text-xs text-muted-foreground">
                You can change it later.
              </p>
            )}
          </FormField>
          <ul className="space-y-2.5">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2.5 text-sm text-text-secondary">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
                {text}
              </li>
            ))}
          </ul>
          <Button type="submit" className="h-9 w-full hover:bg-primary-hover" disabled={pending}>
            {pending ? "Creating organization…" : "Create organization"}
          </Button>
        </form>
      </section>

      {hasWorkspace && (
        <p className="text-center text-sm text-muted-foreground">
          <Link href="/dashboard" className="font-medium text-link hover:underline">
            Back to {session.organization?.name}
          </Link>
        </p>
      )}
    </div>
  )
}
