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
import type { EventOption } from "@/lib/webhooks"

/**
 * "Add webhook" (UC-9.7 steps 1-3): the name, the https address and the events to send. The
 * signing secret is shown once afterwards, in the dialog of `webhooks-page.tsx`.
 */
export function AddWebhookDialog({
  open,
  onOpenChange,
  events,
  onAdd,
  busy,
  errors,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  events: EventOption[]
  onAdd: (data: { name: string; url: string; events: string[] }) => void
  busy: boolean
  errors: Record<string, string>
}) {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [chosen, setChosen] = useState<string[]>([])

  const close = (next: boolean) => {
    if (!next) {
      setName("")
      setUrl("")
      setChosen([])
    }
    onOpenChange(next)
  }

  const toggle = (key: string) =>
    setChosen((before) =>
      before.includes(key) ? before.filter((one) => one !== key) : [...before, key],
    )

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
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
            <div>
              <Label htmlFor="webhook-name" className="text-[13px]">
                Name
              </Label>
              <Input
                id="webhook-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
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
                <p id="webhook-url-help" className="mt-1.5 text-xs text-muted-foreground">
                  An https address that can be reached from the internet. Addresses inside a
                  private network are refused.
                </p>
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
          </div>

          {!busy && (!name.trim() || !url.trim() || chosen.length === 0) && (
            <p id="webhook-missing" className="mt-4 text-[13px] text-muted-foreground">
              Give the webhook a name and an address and choose at least one event, then you can add it.
            </p>
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
      </DialogContent>
    </Dialog>
  )
}
