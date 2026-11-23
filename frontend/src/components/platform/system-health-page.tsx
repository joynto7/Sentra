"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Activity,
  Bot,
  CircleCheck,
  CircleHelp,
  Database,
  ExternalLink,
  HardDrive,
  Info,
  ListOrdered,
  Server,
  Shield,
  TriangleAlert,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { ThresholdsDialog } from "@/components/platform/thresholds-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  type ComponentStatus,
  type HealthComponent,
  STATUS_LABEL,
  type SystemHealth,
  combined,
  systemHealth,
} from "@/lib/system-health"
import { cn } from "@/lib/utils"

const WHEN = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" })
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

const ICONS: Record<string, LucideIcon> = {
  api: Server,
  workers: Activity,
  queue: ListOrdered,
  database: Database,
  object_storage: HardDrive,
  llm: Bot,
  shield: Shield,
}

const TONE: Record<ComponentStatus, string> = {
  operational: "text-success",
  warning: "text-warning",
  alert: "text-destructive",
  unknown: "text-muted-foreground",
}

function StatusMark({ status }: { status: ComponentStatus }) {
  const Icon = status === "operational" ? CircleCheck : status === "unknown" ? CircleHelp : TriangleAlert
  return <Icon className={cn("size-4 shrink-0", TONE[status])} aria-hidden="true" />
}

/** One component of Sentra, with its status in words as well as in colour (WCAG 1.4.1). */
function ComponentCard({ component }: { component: HealthComponent }) {
  const Icon = ICONS[component.key] ?? Activity
  return (
    <section aria-label={component.label} className="rounded-[10px] border bg-card p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        {component.label}
      </h3>
      <p className={cn("mt-2 flex items-center gap-1.5 text-sm font-medium", TONE[component.status])}>
        <StatusMark status={component.status} />
        {STATUS_LABEL[component.status]}
      </p>
      <ul className="mt-1.5 space-y-0.5 text-sm text-muted-foreground">
        {component.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Screen 63: how every component of Sentra is doing (FR-10.6, UC-10.9), for Platform
 * Administrators. Operational data only, never an organization's content (NFR-3.3).
 */
export function SystemHealthPage() {
  const [data, setData] = useState<SystemHealth | null>(null)
  const [error, setError] = useState(false)
  const [reloads, setReloads] = useState(0)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    systemHealth(controller.signal)
      .then((found) => {
        setData(found)
        setError(false)
      })
      .catch(() => !controller.signal.aborted && setError(true))
    return () => controller.abort()
  }, [reloads])

  const reload = useCallback(() => setReloads((n) => n + 1), [])
  // UC-10.9 step 5: where an alert can be followed up. The operator configures these; without
  // them the row says so instead of carrying a dead link.
  const links = [
    data?.grafana_url && { href: data.grafana_url, text: "Open Grafana dashboard" },
    data?.logs_url && { href: data.logs_url, text: "View logs" },
  ].filter(Boolean) as { href: string; text: string }[]

  return (
    <div className="min-w-0">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">System Health</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every component of Sentra, as it is right now.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={reload} disabled={!data && !error}>
          Check again
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-4">
            The health of the platform could not be read, so what it says may be out of date.
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!data && !error && (
        <div className="space-y-4" role="status" aria-label="Reading the platform's health">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {data && (
        <div className="space-y-6">
          <Alert
            variant={data.status === "alert" ? "destructive" : "default"}
            role="status"
            aria-live="polite"
            className={cn(data.status === "warning" && "border-warning")}
          >
            <StatusMark status={data.status} />
            <AlertDescription className="font-medium">{data.headline}</AlertDescription>
          </Alert>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.components.map((component) => (
              <ComponentCard key={component.key} component={component} />
            ))}
          </div>

          <section aria-label="Active alerts" className="rounded-[10px] border bg-card">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Active alerts</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                What is wrong, what it means, and where to look.
              </p>
            </div>
            {data.open_alerts.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No alert is open. A component that passes a threshold raises one by itself.
              </p>
            ) : (
              <div>
                <Table
                  container={{
                    tabIndex: 0,
                    role: "group",
                    "aria-label": "Active alerts",
                    className: "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  }}
                >
                  <TableHeader>
                    <TableRow>
                      <TableHead>Alert</TableHead>
                      <TableHead className="w-40">Component</TableHead>
                      <TableHead className="w-24">Since</TableHead>
                      <TableHead>Effect</TableHead>
                      <TableHead className="w-44">Links</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.open_alerts.map((alert) => (
                      <TableRow key={alert.id}>
                        <TableCell className="align-top font-medium">
                          {alert.summary}
                          {alert.repeats > 1 && (
                            <span className="tabular block text-xs font-normal text-muted-foreground">
                              seen {alert.repeats} times, last at {WHEN.format(new Date(alert.last_seen_at))}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="align-top">{alert.component_label}</TableCell>
                        <TableCell className="tabular align-top">
                          {WHEN.format(new Date(alert.opened_at))}
                        </TableCell>
                        <TableCell className="align-top text-muted-foreground">{alert.effect}</TableCell>
                        <TableCell className="align-top">
                          {links.length === 0 ? (
                            <span className="text-xs text-muted-foreground">
                              No dashboard configured
                            </span>
                          ) : (
                            <ul className="space-y-1">
                              {links.map((link) => (
                                <li key={link.text}>
                                  <a
                                    href={link.href}
                                    target="_blank"
                                    rel="noreferrer"
                                    // 24 px tall, so each link is a target of its own (WCAG 2.5.8)
                                    className="inline-flex min-h-6 items-center gap-1 text-sm text-primary underline underline-offset-2 hover:no-underline"
                                  >
                                    {link.text}
                                    <ExternalLink className="size-3.5" aria-hidden="true" />
                                  </a>
                                </li>
                              ))}
                            </ul>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section aria-label="Alert thresholds" className="rounded-[10px] border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="text-sm font-semibold">Alert thresholds</h2>
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              </div>
              <dl className="mt-3 space-y-1.5 text-sm">
                {[
                  ["Queue length", `${data.thresholds.queue_length.toLocaleString("en-GB")} jobs`],
                  ["Error rate", `${data.thresholds.error_rate_percent} %`],
                  ["Worker load", `${data.thresholds.worker_load_percent} %`],
                  ["Object storage", `${data.thresholds.storage_percent} % of its disk`],
                  ["Gateway silence", `${data.thresholds.gateway_silence_minutes} min`],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-2">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="tabular">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                {data.thresholds.custom
                  ? `Set by ${data.thresholds.set_by ?? "a Platform Administrator"}.`
                  : "The platform's defaults; nobody has changed them."}
              </p>
            </section>

            <section aria-label="Alert history" className="rounded-[10px] border bg-card p-4">
              <h2 className="text-sm font-semibold">Alert history</h2>
              {data.history.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  No alert has been closed yet.
                </p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {combined(data.history).map(({ alert, times }) => (
                    <li key={`${alert.component}:${alert.kind}`} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{alert.summary}</span>
                      {times > 1 && <span className="tabular text-muted-foreground">× {times}</span>}
                      <Badge variant="outline" className="text-xs">
                        {alert.closed_automatically ? "closed automatically" : "closed"}
                      </Badge>
                      <span className="tabular text-xs text-muted-foreground">
                        {alert.closed_at ? DAY.format(new Date(alert.closed_at)) : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {data.notice}
          </p>

          <ThresholdsDialog
            thresholds={data.thresholds}
            open={editing}
            onClose={() => setEditing(false)}
            onSaved={(found) => {
              setData(found)
              setEditing(false)
            }}
          />
        </div>
      )}
    </div>
  )
}
