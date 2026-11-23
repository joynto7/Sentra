"use client"

import { useState } from "react"
import { Info } from "lucide-react"

import { FormField } from "@/components/auth/form-field"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api"
import {
  type Deployable,
  type DeployResult,
  type GuardrailTerms,
  deployPolicy,
} from "@/lib/shield"
import { cn } from "@/lib/utils"

type Written = { applies_to: "input" | "output"; action: "block" | "mask"; terms: string; message: string }

const EMPTY: Written = { applies_to: "output", action: "block", terms: "", message: "" }

/**
 * UC-8.4 step 1: the approved fixes of one remediation become the target's next policy version.
 * The terms a guardrail matches are written here, by a person: Sentra never writes them, and a
 * guardrail without them is left out of the version with its reason (6a).
 */
export function DeployDialog({
  targetId,
  deployable,
  open,
  onClose,
  onDone,
}: {
  targetId: string
  deployable: Deployable[]
  open: boolean
  onClose: () => void
  onDone: (result: DeployResult) => void
}) {
  // The dialog is mounted when it opens, so every field starts where the person expects it.
  const [chosen, setChosen] = useState<string>("")
  const [written, setWritten] = useState<Record<number, Written>>({})
  const [later, setLater] = useState(false)
  const [at, setAt] = useState("")
  const [problem, setProblem] = useState<{ field?: string; message: string } | undefined>()
  const [busy, setBusy] = useState(false)

  const one = deployable.find((row) => row.finding === chosen) ?? deployable[0]
  const needing = one?.fixes.filter((fix) => fix.needs_terms) ?? []
  const carried = one?.fixes.filter((fix) => fix.becomes && !fix.needs_terms) ?? []
  const left = one?.fixes.filter((fix) => !fix.becomes) ?? []

  function change(fix: number, part: Partial<Written>) {
    setWritten((old) => ({ ...old, [fix]: { ...EMPTY, ...old[fix], ...part } }))
  }

  async function deploy() {
    if (!one) return
    setBusy(true)
    setProblem(undefined)
    const guardrails: GuardrailTerms[] = needing
      .map((fix) => {
        const said = written[fix.fix] ?? EMPTY
        return {
          fix: fix.fix,
          applies_to: said.applies_to,
          action: said.action,
          terms: said.terms
            .split("\n")
            .map((term) => term.trim())
            .filter(Boolean),
          message: said.message.trim() || null,
        }
      })
      .filter((guardrail) => guardrail.terms.length > 0)
    try {
      onDone(
        await deployPolicy(targetId, {
          finding_code: one.finding,
          version: one.version,
          guardrails,
          at: later && at ? new Date(at).toISOString() : null,
        }),
      )
    } catch (error) {
      const detail = error instanceof ApiError ? error.details?.[0] : undefined
      setProblem({
        field: detail?.field,
        message:
          detail?.message ??
          (error instanceof ApiError ? error.message : "The version could not be deployed."),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Deploy approved fixes</DialogTitle>
          <DialogDescription>
            The fixes this gateway can carry become the target&apos;s next Shield Policy version.
            Everything else stays a change inside the application.
          </DialogDescription>
        </DialogHeader>

        {deployable.length > 1 && (
          <div className="mt-2 space-y-2">
            <Label htmlFor="which">Remediation</Label>
            <RadioGroup
              id="which"
              className="gap-2"
              value={chosen}
              onValueChange={setChosen}
            >
              {deployable.map((row) => (
                <Label
                  key={row.finding}
                  htmlFor={`which-${row.finding}`}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-[10px] border p-3 font-normal",
                    chosen === row.finding ? "border-primary bg-primary/5" : "hover:bg-muted/40",
                  )}
                >
                  <RadioGroupItem id={`which-${row.finding}`} value={row.finding} className="mt-0.5" />
                  <span className="block">
                    <span className="block text-[13px] font-medium">
                      {row.finding} · {row.finding_title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      proposal version {row.version} · {row.fixes.length} fixes
                    </span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </div>
        )}

        {one && (
          <div className="mt-4 space-y-5">
            {needing.map((fix) => {
              const said = written[fix.fix] ?? EMPTY
              return (
                <section
                  key={fix.fix}
                  aria-labelledby={`fix-${fix.fix}`}
                  className="rounded-[10px] border p-4"
                >
                  <h3 id={`fix-${fix.fix}`} className="text-sm font-semibold">
                    {fix.title}
                  </h3>
                  <p className="mt-1 text-[13px] text-text-secondary">
                    This guardrail needs the exact terms it should match. Sentra never writes them:
                    write one term per line, in the words of your own application.
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <FormField id={`applies-${fix.fix}`} label="It looks at">
                      <select
                        id={`applies-${fix.fix}`}
                        className="h-9 w-full rounded-[7px] border bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        value={said.applies_to}
                        onChange={(event) =>
                          change(fix.fix, { applies_to: event.target.value as "input" | "output" })
                        }
                      >
                        <option value="output">the answers of the application</option>
                        <option value="input">the requests of its users</option>
                      </select>
                    </FormField>
                    <FormField id={`action-${fix.fix}`} label="And then">
                      <select
                        id={`action-${fix.fix}`}
                        className="h-9 w-full rounded-[7px] border bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        value={said.action}
                        onChange={(event) =>
                          change(fix.fix, { action: event.target.value as "block" | "mask" })
                        }
                      >
                        <option value="block">stops the request or the answer</option>
                        <option value="mask">removes the term and lets it through</option>
                      </select>
                    </FormField>
                  </div>
                  <div className="mt-3 space-y-3">
                    <FormField id={`terms-${fix.fix}`} label="Terms, one per line">
                      <Textarea
                        id={`terms-${fix.fix}`}
                        rows={3}
                        value={said.terms}
                        onChange={(event) => change(fix.fix, { terms: event.target.value })}
                      />
                    </FormField>
                    <FormField
                      id={`message-${fix.fix}`}
                      label="What a blocked request is told (optional)"
                    >
                      <Input
                        id={`message-${fix.fix}`}
                        value={said.message}
                        placeholder="This request can't be handled."
                        onChange={(event) => change(fix.fix, { message: event.target.value })}
                      />
                    </FormField>
                  </div>
                </section>
              )
            })}

            {(carried.length > 0 || left.length > 0) && (
              <section aria-labelledby="the-rest" className="rounded-[10px] border bg-muted/20 p-4">
                <h3 id="the-rest" className="text-sm font-semibold">
                  The other fixes of this remediation
                </h3>
                <ul className="mt-2 space-y-1.5 text-[13px] text-text-secondary">
                  {carried.map((fix) => (
                    <li key={fix.fix}>
                      <span className="font-medium">{fix.title}</span> — goes into the policy as{" "}
                      {fix.becomes?.toLowerCase()}.
                    </li>
                  ))}
                  {left.map((fix) => (
                    <li key={fix.fix}>
                      <span className="font-medium">{fix.title}</span> — stays a change in the
                      application: {fix.reason}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="space-y-2">
              <Label className="flex items-center gap-2 font-normal">
                <input
                  type="checkbox"
                  className="size-4 rounded border"
                  checked={later}
                  onChange={(event) => setLater(event.target.checked)}
                />
                Deploy in a maintenance window instead of now
              </Label>
              {later && (
                <FormField id="at" label="Deploy at">
                  <Input
                    id="at"
                    type="datetime-local"
                    value={at}
                    onChange={(event) => setAt(event.target.value)}
                  />
                </FormField>
              )}
            </div>

            {problem && (
              <p role="alert" className="text-sm text-destructive">
                {problem.message}
              </p>
            )}

            <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Every deployment writes a new version and changes no earlier one, so you can always
              roll back to the version that works.
            </p>
          </div>
        )}

        {!busy && !one && (
          <p id="deploy-at-hint" className="mt-4 text-[13px] text-muted-foreground">
            No approved remediation of this target waits to be deployed.
          </p>
        )}
        {!busy && one && later && !at && (
          <p id="deploy-at-hint" className="mt-4 text-[13px] text-muted-foreground">
            Choose when the maintenance window starts, or deploy now.
          </p>
        )}
        <DialogFooter className="mt-6">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="hover:bg-primary-hover"
            disabled={busy || !one || (later && !at)}
            aria-describedby={!one || (later && !at) ? "deploy-at-hint" : undefined}
            onClick={deploy}
          >
            {busy ? "Deploying…" : later ? "Schedule the deployment" : "Deploy now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
