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
import { type WebhookDraft, sanitizeWebhookDraft, webhookDraftIsEmpty } from "@/components/integrations/integration-drafts"
import { useIntegrationDraft } from "@/components/integrations/use-integration-draft"
import { DraftStatus } from "@/components/wizard/status"
import type { EventOption } from "@/lib/webhooks"

/**
 * "Add webhook" (UC-9.7 steps 1-3): the name, the https address and the events to send. The
 * signing secret is shown once afterwards, in the dialog of `webhooks-page.tsx`.
 */
export function AddWebhookDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  events: EventOption[]
  onAdd: (data: { name: string; url: string; events: string[] }) => void
  busy: boolean
  errors: Record<string, string>
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        {/* Mounted with the dialog: every opening starts from nothing the last one typed */}
        {props.open && <WebhookForm {...props} />}
      </DialogContent>
    </Dialog>
  )
}

function WebhookForm({
  events,
  onAdd,
  busy,
  errors,
}: {
  events: EventOption[]
  onAdd: (data: { name: string; url: string; events: string[] }) => void
  busy: boolean
  errors: Record<string, string>
}) {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [chosen, setChosen] = useState<string[]>([])

  const draft = useIntegrationDraft<WebhookDraft>("webhook", sanitizeWebhookDraft, webhookDraftIsEmpty)
  const touched = useRef(false)
  useEffect(() => {
    // The address is deliberately not part of the draft: it can carry a token
    if (touched.current) draft.noteEdit({ name, events: chosen })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, chosen])

  function restore() {
    const kept = draft.offered?.value
    if (!kept) return
    setName(kept.name)
    setChosen(kept.events.filter((key) => events.some((one) => one.key === key)))
    touched.current = true
    draft.accept()
  }

  const toggle = (key: string) => {
    touched.current = true
    setChosen((before) =>
      before.includes(key) ? before.filter((one) => one !== key) : [...before, key],
    )
  }

  let host = ""
  try {
    host = url.trim() ? new URL(url.trim()).host : ""
  } catch {
    host = ""
  }
  const eventNames = chosen.map((key) => events.find((one) => one.key === key)?.label ?? key)

  return (
    <>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            onAdd({ name, url, events: chosen })
          }}
        >
          <DialogHeader>
            <DialogTitle>Add webhook</DialogTitle>
            <DialogDescription>
              Sentra sends the events you choose to this address, signed, as soon as the receiving
              system has confirmed a test event.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 space-y-4">
            {draft.offered && (
              <div role="status" className="rounded-[8px] border bg-muted/40 p-3 text-[13px]">
                <p>A draft is kept here. The address is not.</p>
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
            <div>
              <Label htmlFor="webhook-name" className="text-[13px]">
                Name
              </Label>
              <Input
                id="webhook-name"
                value={name}
                onChange={(event) => {
                  touched.current = true
                  setName(event.target.value)
                }}
                placeholder="Jira Service Management"
                className="mt-1.5 h-9"
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? "webhook-name-error" : undefined}
                required
              />
              {errors.name && (
                <p id="webhook-name-error" role="alert" className="mt-1.5 text-[13px] text-destructive">
                  {errors.name}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="webhook-url" className="text-[13px]">
                URL
              </Label>
              <Input
                id="webhook-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://jira.example.com/hooks/sentra"
                className="mt-1.5 h-9"
                aria-invalid={errors.url ? true : undefined}
                aria-describedby={errors.url ? "webhook-url-error" : "webhook-url-help"}
                required
              />
              {errors.url ? (
                <p id="webhook-url-error" role="alert" className="mt-1.5 text-[13px] text-destructive">
                  {errors.url}
                </p>
              ) : (
                <p id="webhook-url-help" className="mt-1.5 text-xs text-muted-foreground">A public https address. Private addresses are refused.</p>
              )}
            </div>

            <fieldset>
              <legend className="text-[13px] font-medium">Events to send</legend>
              {errors.events && (
                <p role="alert" className="mt-1.5 text-[13px] text-destructive">
                  {errors.events}
                </p>
              )}
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {events.map((event) => (
                  <div key={event.key} className="flex items-start gap-2">
                    <Checkbox
                      id={`event-${event.key}`}
                      checked={chosen.includes(event.key)}
                      onCheckedChange={() => toggle(event.key)}
                      className="mt-0.5"
                    />
                    <label htmlFor={`event-${event.key}`} className="text-[13px] leading-snug">
                      {event.label}
                    </label>
                  </div>
                ))}
              </div>
            </fieldset>

            <section aria-label="What adding will do" aria-live="polite" className="rounded-[8px] border bg-muted/40 p-3 text-[13px]">
              <h3 className="font-medium">What adding will do</h3>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-text-secondary">
                <li>Saves the webhook{name.trim() ? ` “${name.trim()}”` : ""}. Adding sends nothing to {host ? host : "the address"}.</li>
                <li>{eventNames.length ? `It will receive: ${eventNames.join(", ")}.` : "No event is chosen yet."}</li>
                <li>A signing secret is created and shown once; keep it, Sentra cannot show it again.</li>
                <li>
                  It stays not verified, and sends nothing, until you send a test event
                  {host ? ` to ${host}` : ""} and that system answers. Only then it starts to receive events.
                </li>
              </ul>
            </section>
            <DraftStatus feedback={draft.feedback} onRetry={draft.retry} />
          </div>

          {!busy && (!name.trim() || !url.trim() || chosen.length === 0) && (
            <p id="webhook-missing" className="mt-4 text-[13px] text-muted-foreground">Add a name, an address and an event.</p>
          )}
          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline" className="h-9">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              className="h-9 hover:bg-primary-hover"
              disabled={busy || !name.trim() || !url.trim() || chosen.length === 0}
              aria-describedby={
                !name.trim() || !url.trim() || chosen.length === 0 ? "webhook-missing" : undefined
              }
            >
              {busy ? "Adding…" : "Add webhook"}
            </Button>
          </DialogFooter>
        </form>
    </>
  )
}
