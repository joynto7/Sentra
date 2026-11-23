"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { AddWebhookDialog } from "@/components/integrations/add-webhook-dialog"
import { IntegrationsTabs } from "@/components/integrations/integrations-tabs"
import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { CopyButton } from "@/components/sentra/copy-button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError, fieldErrors } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import { formatDateTime } from "@/lib/targets"
import {
  STATUS_LABELS,
  type EventOption,
  type Webhook,
  type WebhookDelivery,
  addWebhook,
  changeWebhook,
  deliveryState,
  listWebhooks,
  removeWebhook,
  rotateWebhookSecret,
  testWebhook,
  webhookDeliveries,
} from "@/lib/webhooks"

const CHIP = "rounded-full border bg-card px-2 py-0.5 text-xs font-medium"

function StatusChip({ webhook }: { webhook: Webhook }) {
  const label = STATUS_LABELS[webhook.status]
  if (webhook.status === "active") {
    return <span className={`${CHIP} border-success/40 text-success`}>{label}</span>
  }
  if (webhook.status === "disabled") {
    return (
      <span className={`${CHIP} inline-flex items-center gap-1 border-destructive/40 text-destructive`}>
        <TriangleAlert className="size-3" aria-hidden="true" />
        {label}
      </span>
    )
  }
  return <span className={`${CHIP} text-text-secondary`}>{label}</span>
}

function DeliveryChip({ delivery }: { delivery: WebhookDelivery }) {
  const state = deliveryState(delivery)
  const colour =
    state === "ok"
      ? "border-success/40 text-success"
      : state === "failed"
        ? "border-destructive/40 text-destructive"
        : "border-warning/40 text-warning"
  return (
    <span className={`${CHIP} tabular ${colour}`}>
      {delivery.status_code ?? "no answer"}
      {delivery.attempts > 1 ? ` · ${delivery.attempts} attempts` : ""}
    </span>
  )
}

/**
 * Screen 57 (UC-9.7 Manage Webhooks, with 4a and 6a): the organization's endpoints, the events
 * each one carries, and how its last deliveries went. A webhook is only sent events once the
 * receiving system has confirmed a signed test event.
 */
export function WebhooksPage() {
  const canManage = useCan("manage_api_keys_and_webhooks")
  const [data, setData] = useState<{ webhooks: Webhook[]; events: EventOption[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)
  // The deliveries are kept with the webhook they belong to, so a slow answer can never be shown
  // under another endpoint's name.
  const [loaded, setLoaded] = useState<{ id: string; rows: WebhookDelivery[] } | null>(null)
  const [openedId, setOpenedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [secret, setSecret] = useState<{ value: string; name: string } | null>(null)
  const [tested, setTested] = useState<{ ok: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    listWebhooks()
      .then((found) => {
        setData(found)
        setFailed(false)
        setChosen((before) =>
          before && found.webhooks.some((one) => one.id === before)
            ? before
            : (found.webhooks[0]?.id ?? null),
        )
      })
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => {
    if (canManage) load()
  }, [canManage, load])

  useEffect(() => {
    if (!chosen) return
    webhookDeliveries(chosen)
      .then((found) => setLoaded({ id: chosen, rows: found }))
      .catch(() => setLoaded({ id: chosen, rows: [] }))
  }, [chosen])

  if (canManage === false) {
    return (
      <>
        <PageHeader title="Integrations" />
        <IntegrationsTabs active="webhooks" />
        <EmptyState
          title="Only Organization Administrators manage webhooks"
          description="Ask an Organization Administrator of your organization to send Sentra's events to your system."
        />
      </>
    )
  }

  const webhook = data?.webhooks.find((one) => one.id === chosen) ?? null
  const deliveries = loaded && loaded.id === chosen ? loaded.rows : null
  const opened = deliveries?.find((one) => one.id === openedId) ?? deliveries?.[0] ?? null
  const labelOf = (key: string) => data?.events.find((one) => one.key === key)?.label ?? key

  function problem(error: unknown, fallback: string): void {
    const named = fieldErrors(error)
    setErrors(named)
    if (!Object.keys(named).length) {
      toast.error(error instanceof ApiError ? error.message : fallback)
    }
  }

  async function add(details: { name: string; url: string; events: string[] }) {
    setBusy(true)
    setErrors({})
    try {
      const made = await addWebhook(details)
      setAdding(false)
      setSecret({ value: made.secret, name: made.webhook.name })
      setChosen(made.webhook.id)
      load()
    } catch (error) {
      problem(error, "The webhook could not be added.")
    } finally {
      setBusy(false)
    }
  }

  async function test(id: string) {
    setBusy(true)
    setTested(null)
    try {
      const answer = await testWebhook(id)
      setTested({ ok: answer.ok, message: answer.message })
      load()
      webhookDeliveries(id).then((found) => {
        setLoaded({ id, rows: found })
        setOpenedId(null)
      })
    } catch (error) {
      problem(error, "The test event could not be sent.")
    } finally {
      setBusy(false)
    }
  }

  async function change(id: string, changes: Parameters<typeof changeWebhook>[1], said: string) {
    setBusy(true)
    try {
      await changeWebhook(id, changes)
      toast.success(said)
      load()
    } catch (error) {
      problem(error, "The webhook could not be changed.")
    } finally {
      setBusy(false)
    }
  }

  async function rotate(id: string, name: string) {
    setBusy(true)
    try {
      const answer = await rotateWebhookSecret(id)
      setSecret({ value: answer.secret, name })
      load()
    } catch (error) {
      problem(error, "The secret could not be rotated.")
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string, name: string) {
    setBusy(true)
    try {
      await removeWebhook(id)
      toast.success(`The webhook ${name} was removed`)
      setChosen(null)
      load()
    } catch (error) {
      problem(error, "The webhook could not be removed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Sentra's events in your own systems — ticketing, chat or monitoring."
        action={
          <Button className="h-9 hover:bg-primary-hover" onClick={() => setAdding(true)}>
            Add webhook
          </Button>
        }
      />
      <IntegrationsTabs active="webhooks" />

      <p className="mb-5 text-[13px] text-text-secondary">
        Webhooks carry a summary and a link, never evidence or secrets. Every delivery is signed
        with HMAC-SHA256, so your system can check that it came from Sentra.
      </p>

      {failed && (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex items-center justify-between gap-4">
            The webhooks could not be loaded.
            <Button variant="outline" size="sm" onClick={load}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!data && !failed && (
        <div className="space-y-2" role="status" aria-label="Loading the webhooks">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {data && data.webhooks.length === 0 && (
        <EmptyState
          title="No webhook yet"
          description="Send the events you care about to a ticketing, chat or monitoring system. Sentra signs every delivery, and your system confirms a test event before anything else is sent."
          action={
            <Button className="h-9 hover:bg-primary-hover" onClick={() => setAdding(true)}>
              Add webhook
            </Button>
          }
        />
      )}

      {data && data.webhooks.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label="Webhooks" className="min-w-0">
            <ul className="space-y-1">
              {data.webhooks.map((one) => (
                <li key={one.id}>
                  <button
                    type="button"
                    onClick={() => setChosen(one.id)}
                    aria-current={one.id === chosen ? "true" : undefined}
                    className={`w-full rounded-[7px] border p-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                      one.id === chosen ? "border-primary bg-accent" : "bg-card hover:bg-muted"
                    }`}
                  >
                    <span className="block truncate text-sm font-medium">{one.name}</span>
                    <span className="mt-1 block">
                      <StatusChip webhook={one} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {webhook && (
            <section aria-labelledby="webhook-heading" className="min-w-0 space-y-5">
              <div className="rounded-[10px] border bg-card p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 id="webhook-heading" className="text-[15px] font-semibold">
                    {webhook.name}
                  </h2>
                  <StatusChip webhook={webhook} />
                </div>
                <p className="mt-2 font-mono text-[13px] break-all text-text-secondary">
                  {webhook.url}
                </p>

                {webhook.status === "disabled" && (
                  <Alert variant="destructive" role="alert" className="mt-4">
                    <TriangleAlert aria-hidden="true" />
                    <AlertDescription>
                      Sentra switched this webhook off on {formatDateTime(webhook.disabled_at ?? "")}{" "}
                      after {webhook.failures} deliveries it could not send. No events are going to
                      it. Fix the receiving system, then send a test event.
                    </AlertDescription>
                  </Alert>
                )}
                {webhook.status === "inactive" && (
                  <Alert role="status" className="mt-4">
                    <CircleAlert aria-hidden="true" />
                    <AlertDescription>
                      Nothing is sent yet. Configure the signing secret in the receiving system,
                      then send a test event — Sentra activates the webhook when the system
                      confirms it.
                    </AlertDescription>
                  </Alert>
                )}
                {tested && (
                  <Alert
                    variant={tested.ok ? "default" : "destructive"}
                    role="alert"
                    className="mt-4"
                  >
                    {tested.ok ? (
                      <CircleCheck aria-hidden="true" />
                    ) : (
                      <CircleAlert aria-hidden="true" />
                    )}
                    <AlertDescription>
                      {tested.ok ? `The test event arrived. ${tested.message}` : tested.message}
                    </AlertDescription>
                  </Alert>
                )}

                <h3 className="mt-5 text-[13px] font-medium">Events</h3>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {webhook.events.map((key) => (
                    <li key={key} className={`${CHIP} text-text-secondary`}>
                      {labelOf(key)}
                    </li>
                  ))}
                </ul>

                <p className="mt-5 border-t pt-4 text-[13px] text-text-secondary">
                  Signed with HMAC-SHA256 · secret created{" "}
                  {formatDateTime(webhook.secret_created_at)} (not shown again)
                  {webhook.secret_is_old && " · over a year old"}
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="h-9 hover:bg-primary-hover"
                    onClick={() => test(webhook.id)}
                    disabled={busy}
                  >
                    Send test event
                  </Button>
                  {webhook.status === "active" && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9"
                      onClick={() => change(webhook.id, { status: "paused" }, `${webhook.name} is paused`)}
                      disabled={busy}
                    >
                      Pause
                    </Button>
                  )}
                  {(webhook.status === "paused" || webhook.status === "disabled") &&
                    webhook.verified_at && (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9"
                        onClick={() =>
                          change(webhook.id, { status: "active" }, `${webhook.name} is active again`)
                        }
                        disabled={busy}
                      >
                        Activate
                      </Button>
                    )}
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9"
                    onClick={() => rotate(webhook.id, webhook.name)}
                    disabled={busy}
                  >
                    Rotate secret
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="ml-auto h-9 text-destructive"
                    onClick={() => remove(webhook.id, webhook.name)}
                    disabled={busy}
                  >
                    Remove
                  </Button>
                </div>
              </div>

              <div className="rounded-[10px] border bg-card">
                <h3 className="border-b p-4 text-[15px] font-semibold">Recent deliveries</h3>
                {deliveries === null ? (
                  <div className="p-4">
                    <Skeleton className="h-24 w-full" />
                  </div>
                ) : deliveries.length === 0 ? (
                  <p className="p-4 text-[13px] text-text-secondary">
                    Nothing has been sent yet. A delivery appears here as soon as one of the chosen
                    events happens.
                  </p>
                ) : (
                  <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <ul className="divide-y border-b md:border-r md:border-b-0" role="list">
                      {deliveries.map((delivery) => (
                        <li key={delivery.id}>
                          <button
                            type="button"
                            onClick={() => setOpenedId(delivery.id)}
                            aria-current={delivery.id === opened?.id ? "true" : undefined}
                            className={`flex w-full items-center justify-between gap-3 p-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                              delivery.id === opened?.id ? "bg-accent" : "hover:bg-muted"
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-[13px] font-medium">
                                {delivery.event}
                              </span>
                              <span className="block text-xs text-text-secondary">
                                {formatDateTime(delivery.created_at)}
                              </span>
                            </span>
                            <DeliveryChip delivery={delivery} />
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="p-4">
                      {opened ? (
                        <>
                          <p className="text-[13px] font-medium">
                            {opened.event} · {formatDateTime(opened.created_at)}
                          </p>
                          <p className="mt-1 text-[13px] text-text-secondary">
                            {opened.delivered_at
                              ? `Delivered in ${opened.duration_ms ?? 0} ms · ${opened.attempts} ${opened.attempts === 1 ? "attempt" : "attempts"}`
                              : (opened.error ?? "On its way.")}
                          </p>
                          <h4 className="mt-4 text-xs font-medium text-text-secondary">
                            What was sent
                          </h4>
                          <pre className="mt-1.5 overflow-x-auto rounded-[7px] border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
                            {JSON.stringify(opened.payload, null, 2)}
                          </pre>
                        </>
                      ) : (
                        <p className="text-[13px] text-text-secondary">
                          Choose a delivery to see what was sent.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      <AddWebhookDialog
        open={adding}
        onOpenChange={setAdding}
        events={data?.events ?? []}
        onAdd={add}
        busy={busy}
        errors={errors}
      />

      <Dialog open={secret !== null} onOpenChange={(next) => !next && setSecret(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>The signing secret of {secret?.name}</DialogTitle>
            <DialogDescription>
              Configure it in the receiving system, which uses it to check the signature of every
              delivery. Sentra will not show it again.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 rounded-[7px] border bg-muted/40 px-3 py-2 font-mono text-[13px] break-all">
              {secret?.value}
            </code>
            <CopyButton text={secret?.value ?? ""} description="Copy the signing secret" />
          </div>
          <DialogFooter className="mt-6">
            <Button type="button" className="h-9 hover:bg-primary-hover" onClick={() => setSecret(null)}>
              I have saved it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
