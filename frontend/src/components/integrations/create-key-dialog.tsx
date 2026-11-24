"use client"

import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { type KeyDraft, keyDraftIsEmpty, sanitizeKeyDraft } from "@/components/integrations/integration-drafts"
import { useIntegrationDraft } from "@/components/integrations/use-integration-draft"
import { DraftStatus } from "@/components/wizard/status"
import type { ApiKeyScope, NewApiKey, ScopeOption, TargetRef } from "@/lib/api-keys"

/** A year from today, as the date field writes it. */
function inAYear(): string {
  const date = new Date()
  date.setFullYear(date.getFullYear() + 1)
  return date.toISOString().slice(0, 10)
}

/**
 * "Create API key" (UC-9.6 steps 1-4): the name and purpose, the scopes, an optional limit to
 * targets, the expiry date, and the password again (NFR-3.5). The key itself appears afterwards,
 * once, in its own dialog.
 */
export function CreateKeyDialog(props: {
  open: boolean
  scopes: ScopeOption[]
  targets: TargetRef[]
  busy: boolean
  /** What the API said about a field, e.g. the expiry date. */
  error?: { field?: string; message: string }
  onClose: () => void
  onCreate: (data: NewApiKey, password: string) => void
}) {
  return (
    <Dialog open={props.open} onOpenChange={(next) => !next && props.onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        {/* The form is mounted with the dialog, so every opening starts empty: nothing typed, and
            above all no password, outlives a closing that the page itself did after a success. */}
        {props.open && <KeyForm {...props} />}
      </DialogContent>
    </Dialog>
  )
}

function KeyForm({
  scopes,
  targets,
  busy,
  error,
  onCreate,
}: {
  scopes: ScopeOption[]
  targets: TargetRef[]
  busy: boolean
  error?: { field?: string; message: string }
  onCreate: (data: NewApiKey, password: string) => void
}) {
  const [name, setName] = useState("")
  const [purpose, setPurpose] = useState("")
  const [chosen, setChosen] = useState<ApiKeyScope[]>([])
  const [limited, setLimited] = useState<string[]>([])
  const [expires, setExpires] = useState(inAYear())
  const [password, setPassword] = useState("")
  const [problem, setProblem] = useState<string | undefined>()

  const draft = useIntegrationDraft<KeyDraft>("api-key", sanitizeKeyDraft, keyDraftIsEmpty)
  const touched = useRef(false)
  const touch = () => {
    touched.current = true
  }
  useEffect(() => {
    if (touched.current) draft.noteEdit({ name, purpose, scopes: chosen, target_ids: limited, expires })
    // The password is deliberately not part of the draft
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, purpose, chosen, limited, expires])

  function restore() {
    const kept = draft.offered?.value
    if (!kept) return
    const known = new Set(scopes.map((one) => one.value))
    const targetIds = new Set(targets.map((one) => one.id))
    setName(kept.name)
    setPurpose(kept.purpose)
    // Only what this organization still offers: a scope or a target that is gone is not brought back
    setChosen(kept.scopes.filter((one): one is ApiKeyScope => known.has(one as ApiKeyScope)))
    setLimited(kept.target_ids.filter((one) => targetIds.has(one)))
    if (kept.expires) setExpires(kept.expires)
    touched.current = true
    draft.accept()
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) return setProblem("Give the key a name.")
    if (chosen.length === 0) return setProblem("Choose at least one scope.")
    if (!password) return setProblem("Enter your password.")
    setProblem(undefined)
    onCreate(
      {
        name: name.trim(),
        purpose: purpose.trim(),
        scopes: chosen,
        target_ids: limited,
        expires_at: new Date(`${expires}T12:00:00`).toISOString(),
      },
      password,
    )
  }

  const scopeLabels = chosen.map((value) => scopes.find((one) => one.value === value)?.label ?? value)
  const notYet = chosen.map((value) => scopes.find((one) => one.value === value)).filter((one) => one && !one.available)
  const targetNames = limited.map((id) => targets.find((one) => one.id === id)?.name ?? id)

  return (
    <>
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              A key lets an integration use the Sentra REST API. It can never manage members, roles
              or other keys.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            {draft.offered && (
              <div role="status" className="rounded-[8px] border bg-muted/40 p-3 text-[13px]">
                <p>A draft is kept on this device, never the password or key.</p>
                <div className="mt-2 flex gap-2">
                  <Button type="button" size="sm" variant="outline" className="h-8" onClick={restore}>
                    Restore the draft
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-8" onClick={draft.discard}>
                    Discard it
                  </Button>
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                value={name}
                onChange={(event) => {
                  touch()
                  setName(event.target.value)
                }}
                placeholder="Release pipeline"
                maxLength={80}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="key-purpose">Purpose</Label>
              <Textarea
                id="key-purpose"
                value={purpose}
                onChange={(event) => {
                  touch()
                  setPurpose(event.target.value)
                }}
                placeholder="The release pipeline of the support chatbot"
                maxLength={300}
                rows={2}
              />
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Scopes</legend>
              <ul className="space-y-2">
                {scopes.map((scope) => (
                  <li key={scope.value} className="flex items-start gap-2">
                    <Checkbox
                      id={`scope-${scope.value}`}
                      checked={chosen.includes(scope.value)}
                      onCheckedChange={(on) => {
                        touch()
                        setChosen((before) =>
                          on ? [...before, scope.value] : before.filter((one) => one !== scope.value),
                        )
                      }}
                    />
                    <Label htmlFor={`scope-${scope.value}`} className="font-normal">
                      {scope.label}
                      {!scope.available && scope.waiting_for && (
                        <span className="block text-xs text-muted-foreground">
                          Not usable yet: it waits for {scope.waiting_for}. A key that holds it can do this as soon as that
                          exists, without asking you again.
                        </span>
                      )}
                    </Label>
                  </li>
                ))}
              </ul>
            </fieldset>
            {targets.length > 0 && (
              <fieldset>
                <legend className="mb-2 text-sm font-medium">
                  Limit to targets <span className="font-normal text-muted-foreground">(optional)</span>
                </legend>
                <ul className="max-h-40 space-y-2 overflow-y-auto">
                  {targets.map((target) => (
                    <li key={target.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`target-${target.id}`}
                        checked={limited.includes(target.id)}
                        onCheckedChange={(on) => {
                          touch()
                          setLimited((before) =>
                            on ? [...before, target.id] : before.filter((one) => one !== target.id),
                          )
                        }}
                      />
                      <Label htmlFor={`target-${target.id}`} className="font-normal">
                        {target.name}
                      </Label>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-muted-foreground">Without a limit, the key reads every target.</p>
              </fieldset>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="key-expires">Expires on</Label>
              <Input
                id="key-expires"
                type="date"
                value={expires}
                onChange={(event) => {
                  touch()
                  setExpires(event.target.value)
                }}
                required
              />
              <p className="text-xs text-muted-foreground">At most two years from today.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="key-password">Your password</Label>
              <Input
                id="key-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Creating a key asks for your password again.
              </p>
            </div>
            <section aria-label="What this key will be able to do" aria-live="polite" className="rounded-[8px] border bg-muted/40 p-3 text-[13px]">
              <h3 className="font-medium">What this key will be able to do</h3>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-text-secondary">
                <li>{scopeLabels.length ? `Scopes: ${scopeLabels.join(", ")}. Nothing else; it can never manage members, roles or other keys.` : "No scope is chosen yet, so it could do nothing."}</li>
                <li>{targetNames.length ? `Targets: only ${targetNames.join(", ")}.` : "Targets: every target of the organization (no limit chosen)."}</li>
                {notYet.length > 0 && <li>{notYet.map((one) => one?.label).join(", ")} cannot be used yet; the key will gain it when it exists.</li>}
                <li>It stops working on {expires || "the date you choose"}. The key is shown once after you create it, and Sentra cannot show it again.</li>
              </ul>
            </section>
            <DraftStatus feedback={draft.feedback} onRetry={draft.retry} />
            {(problem || error) && (
              <p role="alert" className="text-sm text-destructive">
                {problem ?? error?.message}
              </p>
            )}
          </div>
          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" className="hover:bg-primary-hover" disabled={busy}>
              {busy ? "Creating…" : "Create API key"}
            </Button>
          </DialogFooter>
        </form>
    </>
  )
}
