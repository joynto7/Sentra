"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, LockKeyhole, UserCog } from "lucide-react"

import { FormField } from "@/components/auth/form-field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ApiError, apiFetch, fieldErrors } from "@/lib/api"

const POINTS = [
  { icon: UserCog, text: "You'll be the Organization Administrator." },
  { icon: LockKeyhole, text: "Your organization's data is isolated from every other organization." },
  { icon: ArrowRight, text: "Next: invite your team and register your first target." },
]

/** Screen 06, UC-1.6 Create Organization. */
export function CreateOrganizationForm() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setError("Enter an organization name.")
      return
    }
    setPending(true)
    setError(null)
    try {
      await apiFetch("/v1/organizations", { method: "POST", body: JSON.stringify({ name }) })
      // UC-1.6 step 6: the new workspace opens with its first steps (Screen 07).
      router.replace("/getting-started")
    } catch (err) {
      setError(fieldErrors(err).name ?? (err instanceof ApiError ? err.message : "Something went wrong. Try again."))
      setPending(false)
    }
  }

  return (
    <>
      <div className="w-full max-w-[480px] rounded-[10px] border bg-card p-8">
        <h1 className="text-xl font-semibold tracking-tight">Create your organization</h1>
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
      </div>
      <p className="mt-5 text-sm text-muted-foreground">
        Joining an existing organization? Ask its administrator for an invitation.
      </p>
    </>
  )
}
