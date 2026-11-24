"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { GateCard } from "@/components/integrations/gate-card"
import { GateView } from "@/components/integrations/gate-view"
import { IntegrationsTabs } from "@/components/integrations/integrations-tabs"
import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { SeverityBadge, type Severity } from "@/components/sentra/severity-badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { fieldErrors } from "@/lib/api"
import { APPROVAL_WORDS, type Gate, type GateList, changeGate, createGate, listGates } from "@/lib/gates"
import { useCan } from "@/lib/permissions"
import { ENVIRONMENT_LABEL } from "@/lib/targets"
import { cn } from "@/lib/utils"

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"]

/** UC-9.4 steps 1-2: the campaign the gate runs, and what fails a release. */
function CreateGateDialog({
  campaigns,
  open,
  onOpenChange,
  onCreated,
}: {
  campaigns: GateList["campaigns"]
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (code: string) => void
}) {
  const [name, setName] = useState("")
  const [campaign, setCampaign] = useState("")
  const [failOn, setFailOn] = useState<Severity[]>(["critical", "high"])
  const [reopened, setReopened] = useState(true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState("")
  const [busy, setBusy] = useState(false)
  const chosen = campaigns.find((one) => one.code === campaign)

  const save = async () => {
    setBusy(true)
    setErrors({})
    setProblem("")
    try {
      const made = await createGate({
        name,
        campaign_code: campaign,
        fail_on: failOn,
        fail_on_reopened: reopened,
      })
      toast.success(`${made.code} is ready`, {
        description: "Add its command to the pipeline, with a key that may run it.",
      })
      onCreated(made.code)
      // The next opening starts from the defaults, not from this gate
      setName("")
      setCampaign("")
      setFailOn(["critical", "high"])
      setReopened(true)
      onOpenChange(false)
    } catch (error) {
      const named = fieldErrors(error)
      if (Object.keys(named).length) setErrors(named)
      else setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Create a security gate</DialogTitle>
          <DialogDescription>
            A gate runs one of your campaigns whenever a pipeline asks for it, and compares what it finds with the last release it accepted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="gate-name">Name</Label>
            <Input
              id="gate-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Release gate of the support assistant"
              aria-invalid={errors.name ? true : undefined}
              className="mt-1.5"
            />
            {errors.name && (
              <p role="alert" className="mt-1.5 text-[13px] text-destructive">
                {errors.name}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="gate-campaign">Campaign it runs</Label>
            {campaigns.length === 0 ? (
              <p className="mt-1.5 text-[13px] text-muted-foreground">Every campaign has a gate. Make a campaign first.</p>
            ) : (
              <Select value={campaign} onValueChange={setCampaign}>
                <SelectTrigger id="gate-campaign" className="mt-1.5 h-9 w-full">
                  <SelectValue placeholder="Choose a campaign" />
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map((one) => (
                    <SelectItem key={one.code} value={one.code}>
                      {one.code} · {one.name} ({one.target_name})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {errors.campaign_code && (
              <p role="alert" className="mt-1.5 text-[13px] text-destructive">
                {errors.campaign_code}
              </p>
            )}
            {chosen ? (
              <div className="mt-2 space-y-2">
                <p className="text-[13px] text-text-secondary">
                  Each gate run sends {chosen.suite_count} {chosen.suite_count === 1 ? "test suite" : "test suites"} against{" "}
                  {chosen.target_name} ({ENVIRONMENT_LABEL[chosen.target_environment]}), at most{" "}
                  <span className="tabular">{chosen.attempt_budget}</span> attempts. Scope approval:{" "}
                  {APPROVAL_WORDS[chosen.approval_status].toLowerCase()}.
                </p>
                {chosen.target_environment === "production" && (
                  <p
                    role="alert"
                    className="flex items-start gap-2 rounded-[10px] border border-warning/40 bg-warning/5 p-3 text-[13px] text-warning"
                  >
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    This campaign tests the production environment. A release gate belongs on a staging target, so that a weakness is found
                    before the release reaches users.
                  </p>
                )}
                {chosen.approval_status === "awaiting_approval" && (
                  <p
                    role="alert"
                    className="flex items-start gap-2 rounded-[10px] border border-warning/40 bg-warning/5 p-3 text-[13px] text-warning"
                  >
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    Its scope is still waiting for a Security Manager. The gate can be created now, but a pipeline can only run it once the
                    scope is approved.
                  </p>
                )}
              </div>
            ) : null}
          </div>

          <fieldset>
            <legend className="text-[13px] font-medium">A new finding fails the release when it is</legend>
            <div className="mt-1.5 flex flex-wrap gap-3">
              {SEVERITIES.map((severity) => (
                <label key={severity} className="flex items-center gap-2 text-[13px]">
                  <Checkbox
                    checked={failOn.includes(severity)}
                    onCheckedChange={(on) => setFailOn((old) => (on ? [...old, severity] : old.filter((one) => one !== severity)))}
                  />
                  <SeverityBadge severity={severity} />
                </label>
              ))}
            </div>
            {errors.fail_on && (
              <p role="alert" className="mt-1.5 text-[13px] text-destructive">
                {errors.fail_on}
              </p>
            )}
            <label className="mt-3 flex items-center gap-2 text-[13px]">
              <Checkbox checked={reopened} onCheckedChange={(on) => setReopened(Boolean(on))} />A finding that was fixed and came back fails
              the release as well
            </label>
          </fieldset>

          <section aria-label="What creating will do" aria-live="polite" className="rounded-[8px] border bg-muted/40 p-3 text-[13px]">
            <h3 className="font-medium">What creating will do</h3>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-text-secondary">
              <li>
                Creates the gate{name.trim() ? ` “${name.trim()}”` : ""}. It runs nothing now: it runs the campaign only when a pipeline
                asks, with an API key that may run security gates.
              </li>
              <li>
                {failOn.length || reopened
                  ? `A release fails on a new ${failOn.length ? failOn.join(", ") : "—"} finding${reopened ? ", or on a fixed finding that came back" : ""}.`
                  : "No condition is chosen, so this gate would never fail a release."}
              </li>
            </ul>
          </section>

          {problem && (
            <Alert variant="destructive">
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          )}
        </div>

        {!busy && (!name.trim() || !campaign) && (
          <p id="gate-missing" className="text-[13px] text-muted-foreground">
            Add a name and a campaign.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={busy || !name.trim() || !campaign}
            aria-describedby={!name.trim() || !campaign ? "gate-missing" : undefined}
            className="hover:bg-primary-hover"
          >
            Create the gate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Screen 55 when the organization has more than one gate: each with its policy and how its last
 * release went. With one gate it opens that gate instead, because the screen is about the gate.
 */
export function GatesPage() {
  const router = useRouter()
  const canManage = useCan("manage_security_gates")
  const [data, setData] = useState<GateList | null>(null)
  const [error, setError] = useState(false)
  const [creating, setCreating] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [show, setShow] = useState<"all" | "failing" | "passing" | "paused">("all")
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback((signal?: AbortSignal) => {
    listGates(signal)
      .then((found) => {
        setData(found)
        setError(false)
      })
      .catch(() => setError(true))
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load, attempt])

  const rows = data?.rows ?? []
  const paused = rows.filter((gate) => gate.status === "paused")
  const failing = rows.filter((gate) => gate.runs[0]?.verdict === "failed")
  const passing = rows.filter((gate) => gate.runs[0]?.verdict === "passed")
  const shown = show === "failing" ? failing : show === "passing" ? passing : show === "paused" ? paused : rows

  async function toggle(gate: Gate) {
    setBusy(gate.code)
    try {
      await changeGate(gate.code, { status: gate.status === "paused" ? "active" : "paused" })
      toast.success(gate.status === "paused" ? `${gate.name} is active again.` : `${gate.name} is paused.`)
      load()
    } catch (problem) {
      toast.error(problem instanceof Error ? problem.message : "The gate could not be changed.")
    } finally {
      setBusy(null)
    }
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Security gates" />
        <IntegrationsTabs active="gates" />
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex items-center justify-between gap-4">
            The security gates could not be loaded.
            <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading the security gates">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-52 w-full" />
      </div>
    )
  }

  if (data.rows.length === 1) return <GateView code={data.rows[0].code} />

  return (
    <div>
      <PageHeader
        title="Security gates"
        description="Release checks."
        action={
          canManage ? (
            <Button className="h-9 hover:bg-primary-hover" onClick={() => setCreating(true)}>
              Create security gate
            </Button>
          ) : undefined
        }
      />
      <IntegrationsTabs active="gates" />

      {data.rows.length === 0 ? (
        <EmptyState
          title="No security gate yet"
          description={canManage ? "A gate blocks releases that add weaknesses." : "A Security Analyst sets up gates."}
          action={
            canManage ? (
              <Button className="h-9 hover:bg-primary-hover" onClick={() => setCreating(true)}>
                Create security gate
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { id: "all", label: "Gates", value: data.rows.length, note: "In all" },
              { id: "failing", label: "Last release failed", value: failing.length, note: "Needs a look" },
              { id: "passing", label: "Last release passed", value: passing.length, note: "Safe to ship" },
              { id: "paused", label: "Paused", value: paused.length, note: "Not checking" },
            ].map((tile) => (
              <li key={tile.id}>
                <button
                  type="button"
                  aria-pressed={show === tile.id}
                  onClick={() => setShow(tile.id as typeof show)}
                  className={cn(
                    "flex h-full w-full flex-col rounded-2xl border bg-card p-4 text-left outline-none transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring",
                    show === tile.id ? "border-primary shadow-[0_0_0_1px_var(--primary)]" : "hover:border-border-strong",
                  )}
                >
                  <span className="text-xs text-muted-foreground">{tile.label}</span>
                  <span className="tabular mt-1 text-3xl leading-none font-semibold">{tile.value}</span>
                  <span className="mt-2 text-xs text-muted-foreground">{tile.note}</span>
                </button>
              </li>
            ))}
          </ul>
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((gate) => (
              <li key={gate.code} className="min-w-0">
                <GateCard gate={gate} canManage={canManage} busy={busy === gate.code} onToggle={() => void toggle(gate)} />
              </li>
            ))}
            {shown.length === 0 && (
              <li className="col-span-full rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                No gate in this group.
              </li>
            )}
          </ul>
        </>
      )}

      <CreateGateDialog
        campaigns={data.campaigns}
        open={creating}
        onOpenChange={setCreating}
        onCreated={(code) => router.push(`/integrations/gates/${code}`)}
      />
    </div>
  )
}
