"use client"

import { useState } from "react"

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
export function CreateKeyDialog({
  open,
  scopes,
  targets,
  busy,
  error,
  onClose,
  onCreate,
}: {
  open: boolean
  scopes: ScopeOption[]
  targets: TargetRef[]
  busy: boolean
  /** What the API said about a field, e.g. the expiry date. */
  error?: { field?: string; message: string }
  onClose: () => void
  onCreate: (data: NewApiKey, password: string) => void
}) {
  const [name, setName] = useState("")
  const [purpose, setPurpose] = useState("")
  const [chosen, setChosen] = useState<ApiKeyScope[]>([])
  const [limited, setLimited] = useState<string[]>([])
  const [expires, setExpires] = useState(inAYear())
  const [password, setPassword] = useState("")
  const [problem, setProblem] = useState<string | undefined>()

  function close(next: boolean) {
    if (next) return
    setName("")
    setPurpose("")
    setChosen([])
    setLimited([])
    setExpires(inAYear())
    setPassword("")
    setProblem(undefined)
    onClose()
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

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              A key lets an integration use the Sentra REST API. It can never manage members, roles
              or other keys.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
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
                onChange={(event) => setPurpose(event.target.value)}
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
                      onCheckedChange={(on) =>
                        setChosen((before) =>
                          on ? [...before, scope.value] : before.filter((one) => one !== scope.value),
                        )
                      }
                    />
                    <Label htmlFor={`scope-${scope.value}`} className="font-normal">
                      {scope.label}
                      {!scope.available && scope.waiting_for && (
                        <span className="block text-xs text-muted-foreground">
                          Waits for {scope.waiting_for}; a key may hold it already.
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
                        onCheckedChange={(on) =>
                          setLimited((before) =>
                            on ? [...before, target.id] : before.filter((one) => one !== target.id),
                          )
                        }
                      />
                      <Label htmlFor={`target-${target.id}`} className="font-normal">
                        {target.name}
                      </Label>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-muted-foreground">
                  Without a limit the key reads every target of the organization.
                </p>
              </fieldset>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="key-expires">Expires on</Label>
              <Input
                id="key-expires"
                type="date"
                value={expires}
                onChange={(event) => setExpires(event.target.value)}
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
      </DialogContent>
    </Dialog>
  )
}
