"use client"

import { useCallback, useEffect, useState } from "react"
import { TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { CreateKeyDialog } from "@/components/integrations/create-key-dialog"
import { IntegrationsTabs } from "@/components/integrations/integrations-tabs"
import { usePageCrumbs } from "@/components/layout/breadcrumbs"
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiError, type ApiError as ApiErrorType } from "@/lib/api"
import {
  type ApiKey,
  type ApiKeyCreated,
  type ApiKeyList,
  type NewApiKey,
  STATE_LABEL,
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "@/lib/api-keys"
import { confirmPassword } from "@/lib/mfa"
import { useCan } from "@/lib/permissions"
import { formatDate, formatDateTime } from "@/lib/targets"
import { cn } from "@/lib/utils"

const STATE_STYLE: Record<string, string> = {
  active: "border-border-strong text-text-secondary",
  expiring: "border-warning/60 text-warning",
  expired: "border-border-strong text-muted-foreground",
  revoked: "border-border-strong text-muted-foreground",
}

/** What the page says about a key beside its dates, never in colour alone (NFR-4.3). */
function StateChip({ state }: { state: ApiKey["state"] }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs font-medium whitespace-nowrap",
        STATE_STYLE[state],
      )}
    >
      {state === "expiring" && <TriangleAlert className="size-3.5" aria-hidden="true" />}
      {STATE_LABEL[state]}
    </span>
  )
}

/** UC-9.6 step 4: the key is shown once, and the dialog says so before anything else. */
function CreatedDialog({ created, onClose }: { created: ApiKeyCreated | null; onClose: () => void }) {
  return (
    <Dialog open={created !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>API key created</DialogTitle>
          <DialogDescription>
            Copy this key now. You won&apos;t be able to see it again — Sentra keeps only its hash.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 space-y-3">
          <p className="rounded-[7px] border bg-muted/40 p-3 font-mono text-[13px] break-all">
            {created?.key}
          </p>
          <CopyButton text={created?.key ?? ""} label="Copy key" description="Copy the API key" />
          <p className="text-sm text-text-secondary">
            Store it in the secret store of the integration, for example the secrets of your
            pipeline. Sentra will never show it again.
          </p>
        </div>
        <DialogFooter className="mt-6">
          <Button className="hover:bg-primary-hover" onClick={onClose}>
            I&apos;ve copied the key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Screen 56 (UC-9.6): the keys integrations use for the Sentra REST API (FR-9.5), with their
 * scopes, their limits and their dates. The key itself exists on this page for one dialog only.
 */
export function ApiKeysPage() {
  const canManage = useCan("manage_api_keys_and_webhooks")
  // The keys are the second tab of Integrations since S-S4-05, so the breadcrumb says which one.
  usePageCrumbs([{ label: "API Keys" }])
  const [data, setData] = useState<ApiKeyList | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<{ field?: string; message: string } | undefined>()
  const [created, setCreated] = useState<ApiKeyCreated | null>(null)

  useEffect(() => {
    if (canManage === false) return
    const controller = new AbortController()
    listApiKeys(controller.signal)
      .then((found) => {
        setData(found)
        setError(false)
      })
      .catch(() => !controller.signal.aborted && setError(true))
    return () => controller.abort()
  }, [attempt, canManage])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  async function create(data: NewApiKey, password: string) {
    setBusy(true)
    setProblem(undefined)
    try {
      await confirmPassword(password) // NFR-3.5, right before the key is made
      const key = await createApiKey(data)
      setCreated(key)
      setCreating(false)
      reload()
    } catch (problem) {
      const failed = problem as ApiErrorType
      const detail = failed instanceof ApiError ? failed.details?.[0] : undefined
      setProblem({
        field: detail?.field,
        message: detail?.message ?? (failed instanceof ApiError ? failed.message : "The key could not be created."),
      })
    } finally {
      setBusy(false)
    }
  }

  async function revoke(key: ApiKey) {
    setBusy(true)
    try {
      await revokeApiKey(key.id)
      toast.success(`${key.name} is revoked.`, { description: "Requests with it are refused now." })
      reload()
    } catch (failed) {
      toast.error(failed instanceof ApiError ? failed.message : "The key could not be revoked.")
    } finally {
      setBusy(false)
    }
  }

  if (canManage === false) {
    return (
      <>
        <PageHeader title="Integrations" />
        <IntegrationsTabs active="keys" />
        <EmptyState
          title="Only Organization Administrators manage API keys"
          description="Ask an Organization Administrator of your organization to create or revoke a key for your integration."
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="API Keys"
        description="Keys for pipelines and tools that use the Sentra REST API."
        action={
          <Button className="h-9 hover:bg-primary-hover" onClick={() => setCreating(true)}>
            Create API key
          </Button>
        }
      />
      <IntegrationsTabs active="keys" />

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex items-center justify-between gap-4">
            The API keys could not be loaded.
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!data && !error && (
        <div className="space-y-2" role="status" aria-label="Loading the API keys">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {data && data.rows.length === 0 && (
        <EmptyState
          title="No API key yet"
          description="Create a key for a pipeline or a tool that uses the Sentra REST API. It is shown once, and you choose what it may do."
          action={
            <Button className="h-9 hover:bg-primary-hover" onClick={() => setCreating(true)}>
              Create API key
            </Button>
          }
        />
      )}

      {data && data.rows.length > 0 && (
        <section aria-labelledby="keys" className="min-w-0 rounded-[10px] border bg-card">
          <div className="border-b p-3">
            <h2 id="keys" className="text-[15px] font-semibold">
              Keys
            </h2>
          </div>
          <Table
            container={{
              tabIndex: 0,
              role: "group",
              "aria-label": "API keys",
              className: "rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            }}
          >
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead scope="col" className="text-xs">
                  Name and purpose
                </TableHead>
                <TableHead scope="col" className="text-xs">
                  Key
                </TableHead>
                <TableHead scope="col" className="text-xs">
                  Scopes
                </TableHead>
                <TableHead scope="col" className="text-xs">
                  Targets
                </TableHead>
                <TableHead scope="col" className="text-xs">
                  Expires
                </TableHead>
                <TableHead scope="col" className="text-xs">
                  Last used
                </TableHead>
                <TableHead scope="col" className="text-xs">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="max-w-xs whitespace-normal">
                    <span className="block text-[13px] font-medium">{key.name}</span>
                    {key.purpose && (
                      <span className="block text-xs text-muted-foreground">{key.purpose}</span>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      Created by {key.created_by ?? "someone"} on {formatDate(key.created_at)}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-[13px]">{key.prefix}…</TableCell>
                  <TableCell className="max-w-xs whitespace-normal">
                    <ul className="flex flex-wrap gap-1">
                      {key.scope_labels.map((label) => (
                        <li
                          key={label}
                          className="rounded-md border border-border-strong px-2 py-0.5 text-xs text-text-secondary"
                        >
                          {label}
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell className="max-w-[12rem] text-[13px] whitespace-normal">
                    {key.targets.length === 0
                      ? "All targets"
                      : key.targets.map((target) => target.name).join(", ")}
                  </TableCell>
                  <TableCell className="text-[13px]">
                    <span className="block">{formatDate(key.expires_at)}</span>
                    <StateChip state={key.state} />
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {key.last_used_at ? (
                      formatDateTime(key.last_used_at)
                    ) : (
                      <span className="text-muted-foreground">
                        Never
                        <span className="block text-xs">Unused — consider revoking</span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {key.revoked_at ? (
                      <span className="text-xs text-muted-foreground">
                        Revoked {formatDate(key.revoked_at)}
                        {key.revoked_by ? ` by ${key.revoked_by}` : ""}
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        disabled={busy}
                        onClick={() => revoke(key)}
                      >
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="border-t p-3 text-[13px] text-muted-foreground">
            Keys can never manage members, roles or other keys. A revoked key is refused at once and
            stays listed here.
          </p>
        </section>
      )}

      <p className="mt-4 text-[13px] text-muted-foreground">
        The security gates of the CI/CD pipeline (FR-9.4) and the webhooks (FR-9.6) join this page
        when they are built.
      </p>

      <CreateKeyDialog
        open={creating}
        scopes={data?.scopes ?? []}
        targets={data?.targets ?? []}
        busy={busy}
        error={problem}
        onClose={() => {
          setCreating(false)
          setProblem(undefined)
        }}
        onCreate={create}
      />
      <CreatedDialog created={created} onClose={() => setCreated(null)} />
    </>
  )
}
