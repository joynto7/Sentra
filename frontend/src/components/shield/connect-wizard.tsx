"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowRight, Check, Loader2, TriangleAlert } from "lucide-react"

import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { FormField } from "@/components/auth/form-field"
import { CopyButton } from "@/components/sentra/copy-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { API_URL, ApiError } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import {
  type GatewayCheck,
  type GatewayPosition,
  POSITION_DESCRIPTION,
  POSITION_LABEL,
  POSITION_PHRASE,
  getCheck,
  registerGateway,
  runCommand,
  sendCheck,
} from "@/lib/shield"
import { type Target, getTarget } from "@/lib/targets"
import { cn } from "@/lib/utils"

const STEPS = ["Position", "Run the gateway", "Check traffic"]
const IMAGE_VERSION = "1.0.0" // the tag of the gateway image, as shield/app/config.py reports it
const POLL_MS = 5000
const MAX_POLLS = 24 // two minutes: the gateway reports what it saw every 30 seconds

/** Where Sentra answers for a gateway: the API without the /api the browser itself talks to. */
function sentraAddress(): string {
  try {
    const url = new URL(API_URL, window.location.origin)
    return `${url.origin}${url.pathname.replace(/\/api\/?$/, "")}`
  } catch {
    return "https://sentra.example.com"
  }
}

/** The origin of the application the gateway forwards to, from the target's own endpoint. */
function upstreamOf(target: Target | null, position: GatewayPosition): string {
  if (position === "before_model") return ""
  try {
    return new URL(target?.endpoint_url ?? "").origin
  } catch {
    return ""
  }
}

/** The little diagram of each position: who talks to whom (UC-8.1 step 1). */
function Flow({ parts }: { parts: string[] }) {
  return (
    <span className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {parts.map((part, index) => (
        <span key={part} className="flex items-center gap-1.5">
          <span className="rounded-md border bg-muted/40 px-1.5 py-0.5">{part}</span>
          {index < parts.length - 1 && <ArrowRight className="size-3" aria-hidden="true" />}
        </span>
      ))}
    </span>
  )
}

function Done({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
      <span>{children}</span>
    </li>
  )
}

function Waiting({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
      <span>{children}</span>
    </li>
  )
}

/**
 * Screen 48 (UC-8.1 Connect Shield Gateway, with 3a, 4a and 5a): where the gateway sits, the one
 * sight of its credential with the command that runs it, and the harmless test request that
 * proves the traffic really passes through it.
 */
export function ConnectWizard({ targetId }: { targetId: string }) {
  const router = useRouter()
  const canManage = useCan("manage_shield")
  const wanted = useSearchParams().get("step")
  const [target, setTarget] = useState<Target | null>(null)
  const [missing, setMissing] = useState(false)
  const [step, setStep] = useState(1)
  const [position, setPosition] = useState<GatewayPosition>("in_front")
  const [credential, setCredential] = useState("")
  const [sentraUrl, setSentraUrl] = useState("")
  const [upstream, setUpstream] = useState("")
  const [check, setCheck] = useState<GatewayCheck | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>()
  const [polls, setPolls] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)

  usePageCrumbs([
    { label: "Sentra Shield", href: "/shield" },
    { label: `Connect — ${target?.name ?? "target"}` },
  ])

  useEffect(() => {
    getTarget(targetId)
      .then((found) => {
        setTarget(found)
        // Where Sentra answers is read in the browser, so it is set once the page has one.
        setSentraUrl(sentraAddress())
      })
      .catch(() => setMissing(true))
  }, [targetId])

  // "Troubleshoot" on Screen 47 opens the last step of this wizard for a gateway that exists.
  useEffect(() => {
    if (wanted !== "3") return
    getCheck(targetId)
      .then((state) => {
        setCheck(state)
        setPosition(state.gateway.position)
        setStep(3)
      })
      .catch(() => undefined)
  }, [targetId, wanted])

  // A new step moves the focus to its heading, so keyboard and screen-reader users follow.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    heading.current?.focus()
  }, [step])

  const refresh = useCallback(async () => {
    try {
      setCheck(await getCheck(targetId))
    } catch {
      /* the next window tries again */
    }
  }, [targetId])

  // Step 5: the gateway reports the markers it saw in its next heartbeat, so the page waits.
  useEffect(() => {
    if (step !== 3 || !check?.waiting || polls >= MAX_POLLS) return
    const timer = setTimeout(() => {
      setPolls((n) => n + 1)
      void refresh()
    }, POLL_MS)
    return () => clearTimeout(timer)
  }, [step, check, polls, refresh])

  async function register() {
    setBusy(true)
    setProblem(undefined)
    try {
      const made = await registerGateway(targetId, position)
      setCredential(made.credential)
      setStep(2)
    } catch (failed) {
      setProblem(
        failed instanceof ApiError
          ? failed.message
          : "The gateway could not be connected. Try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    setProblem(undefined)
    setPolls(0)
    try {
      setCheck(await sendCheck(targetId))
    } catch (failed) {
      setProblem(
        failed instanceof ApiError ? failed.message : "The test request could not be sent.",
      )
    } finally {
      setBusy(false)
    }
  }

  if (missing) {
    return (
      <EmptyState
        title="Target not found"
        action={
          <Button asChild variant="outline" className="h-9">
            <Link href="/shield">Back to Sentra Shield</Link>
          </Button>
        }
      />
    )
  }
  if (canManage === false) {
    return (
      <EmptyState
        title="Only the application's developer connects a gateway"
        description="Ask the application's developer."
        action={
          <Button asChild variant="outline" className="h-9">
            <Link href="/shield">Back to Sentra Shield</Link>
          </Button>
        }
      />
    )
  }
  if (!target) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading the target">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  // The two addresses the command needs: what the person typed, or what Sentra already knows.
  const sentraValue = sentraUrl || sentraAddress()
  const upstreamValue = upstream || upstreamOf(target, position)
  const command = runCommand({
    sentraUrl: sentraValue,
    credential,
    upstream: upstreamValue,
    position,
    version: IMAGE_VERSION,
  })

  return (
    <div className="mx-auto max-w-[1240px]">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Connect Sentra Shield</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Step {step} of {STEPS.length} · {target.name}
          </p>
        </div>
        <Button variant="outline" className="h-9" onClick={() => router.push("/shield")}>
          {step === 3 ? "Close" : "Cancel"}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,760px)]">
        <nav aria-label="Connection steps">
          <ol className="flex flex-wrap gap-x-6 gap-y-2 lg:flex-col lg:gap-1">
            {STEPS.map((label, index) => {
              const number = index + 1
              const current = number === step
              const done = number < step
              return (
                <li key={label}>
                  <span
                    aria-current={current ? "step" : undefined}
                    className="flex min-h-9 items-center gap-2.5 px-1"
                  >
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                        current && "border-primary bg-primary text-primary-foreground",
                        done && "border-success bg-success text-white dark:text-background",
                      )}
                      aria-hidden="true"
                    >
                      {done ? <Check className="size-3.5" /> : number}
                    </span>
                    <span className={cn("text-sm", current ? "font-semibold" : "text-muted-foreground")}>
                      {label}
                    </span>
                    {done && <span className="sr-only">(finished)</span>}
                  </span>
                </li>
              )
            })}
          </ol>
        </nav>

        <section aria-labelledby="step-heading" className="min-w-0 rounded-[10px] border bg-card p-6">
          <h2
            id="step-heading"
            ref={heading}
            tabIndex={-1}
            className="text-[15px] font-semibold outline-none"
          >
            {step === 1
              ? "Where should the gateway sit?"
              : step === 2
                ? "Run the gateway in your environment"
                : "Check traffic"}
          </h2>

          {problem && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {problem}
            </p>
          )}

          {step === 1 && (
            <>
              <p className="mt-1 text-sm text-text-secondary">This choice decides which fixes the gateway can carry.</p>
              <RadioGroup
                className="mt-4 gap-3"
                value={position}
                onValueChange={(next) => {
                  setPosition(next as GatewayPosition)
                  setUpstream(upstreamOf(target, next as GatewayPosition))
                }}
              >
                {(["in_front", "before_model"] as GatewayPosition[]).map((one) => (
                  <Label
                    key={one}
                    htmlFor={one}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-[10px] border p-4 font-normal",
                      position === one ? "border-primary bg-primary/5" : "hover:bg-muted/40",
                    )}
                  >
                    <RadioGroupItem id={one} value={one} className="mt-0.5" />
                    <span className="block">
                      <span className="block text-sm font-medium">{POSITION_LABEL[one]}</span>
                      <span className="mt-1 block text-[13px] text-text-secondary">
                        {POSITION_DESCRIPTION[one]}
                      </span>
                      <Flow
                        parts={
                          one === "in_front"
                            ? ["Users", "Sentra Shield", target.name]
                            : [target.name, "Sentra Shield", "LLM provider"]
                        }
                      />
                    </span>
                  </Label>
                ))}
              </RadioGroup>
              <div className="mt-6 flex justify-end">
                <Button className="h-9 hover:bg-primary-hover" disabled={busy} onClick={register}>
                  {busy ? "Connecting…" : "Next: Run the gateway"}
                </Button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p
                role="alert"
                className="mt-3 flex items-start gap-2 rounded-[10px] border border-warning/40 bg-warning/5 p-4 text-sm text-warning"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                This gateway credential is shown only once. Copy it now — Sentra keeps only its
                hash.
              </p>
              <div className="mt-4 space-y-2">
                <Label htmlFor="credential">Gateway credential</Label>
                <p id="credential" className="rounded-[7px] border bg-muted/40 p-3 font-mono text-[13px] break-all">
                  {credential}
                </p>
                <CopyButton
                  text={credential}
                  label="Copy credential"
                  description="Copy the gateway credential"
                />
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <FormField id="sentra-url" label="Sentra's address, as your gateway reaches it">
                  <Input
                    id="sentra-url"
                    value={sentraValue}
                    onChange={(event) => setSentraUrl(event.target.value)}
                  />
                </FormField>
                <FormField
                  id="upstream"
                  label={
                    position === "in_front"
                      ? "Your application's own address"
                      : "Your LLM provider's address"
                  }
                >
                  <Input
                    id="upstream"
                    value={upstreamValue}
                    placeholder={
                      position === "in_front"
                        ? "http://your-application:8080"
                        : "https://api.your-provider.example"
                    }
                    onChange={(event) => setUpstream(event.target.value)}
                  />
                </FormField>
              </div>

              <div className="mt-4 space-y-2">
                <Label htmlFor="command">Run it next to your application</Label>
                <pre
                  id="command"
                  tabIndex={0}
                  role="group"
                  aria-label="The command that runs the gateway"
                  className="overflow-x-auto rounded-[7px] border bg-muted/40 p-3 font-mono text-[13px] whitespace-pre focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {command}
                </pre>
                <CopyButton text={command} label="Copy command" description="Copy the command" />
              </div>

              <p className="mt-4 text-[13px] text-text-secondary">
                Then route the traffic{" "}
                {position === "in_front"
                  ? `of ${target.name} through port 8443 of the gateway`
                  : "of your application to its model through port 8443 of the gateway"}
                . The gateway connects outbound only: Sentra never opens connections into your
                network, and it keeps enforcing its last policy if Sentra can&apos;t be reached.
              </p>

              <div className="mt-6 flex justify-end">
                <Button
                  className="h-9 hover:bg-primary-hover"
                  onClick={() => {
                    setStep(3)
                    void refresh()
                  }}
                >
                  Next: Check traffic
                </Button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <p className="mt-1 text-sm text-text-secondary">
                Sentra sends one harmless request to {target.name} with a one-time marker. Only a
                gateway that really stands in the traffic can report it back.
              </p>
              <ul className="mt-4 space-y-2" aria-live="polite">
                {check?.gateway.connected_at ? (
                  <Done>
                    Gateway connected · version {check.gateway.gateway_version ?? "unknown"} ·
                    position: {POSITION_PHRASE[check.gateway.position]}
                  </Done>
                ) : (
                  <Waiting>Waiting for the gateway to connect…</Waiting>
                )}
                {check?.seen ? (
                  <Done>Harmless test request seen in the traffic path</Done>
                ) : check?.waiting ? (
                  <Waiting>
                    Harmless test request sent — waiting for the gateway to report it (it reports
                    every 30 seconds)
                  </Waiting>
                ) : (
                  <li className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="mt-0.5 size-4 shrink-0 rounded-full border" aria-hidden="true" />
                    <span>Harmless test request not sent yet</span>
                  </li>
                )}
                {check?.gateway.status === "active" && <Done>Gateway active</Done>}
              </ul>

              {check?.message && (
                <p
                  role="alert"
                  className="mt-4 flex items-start gap-2 rounded-[10px] border border-warning/40 bg-warning/5 p-4 text-sm text-warning"
                >
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {check.message}
                </p>
              )}

              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  variant={check?.gateway.status === "active" ? "outline" : "default"}
                  className={cn("h-9", check?.gateway.status !== "active" && "hover:bg-primary-hover")}
                  disabled={busy}
                  onClick={test}
                >
                  {busy ? "Sending…" : check ? "Send the test request again" : "Send the test request"}
                </Button>
                {check?.gateway.status === "active" && (
                  <Button asChild className="h-9 hover:bg-primary-hover">
                    <Link href={`/targets/${targetId}/shield`}>Open the Shield Policy</Link>
                  </Button>
                )}
              </div>

              <details className="group mt-6 rounded-[10px] border bg-muted/20 p-4">
                <summary className="cursor-pointer text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                  It isn&apos;t working — what to check
                </summary>
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[13px] text-text-secondary">
                  <li>
                    <span className="font-medium">The gateway hasn&apos;t connected:</span> check
                    that outbound HTTPS to {sentraValue} is allowed from the gateway, and
                    read <span className="font-mono">docker logs sentra-shield</span>.
                  </li>
                  <li>
                    <span className="font-medium">The test request didn&apos;t pass through it:</span>{" "}
                    the traffic of {target.name} still goes straight to the application. Point its
                    endpoint at the gateway&apos;s port 8443 and send the request again. Policies
                    can&apos;t be deployed until traffic is routed through it.
                  </li>
                  <li>
                    <span className="font-medium">The credential was lost:</span> connect the
                    gateway again from the Sentra Shield page — that issues a new credential for the same
                    gateway and the old one stops working.
                  </li>
                  <li>
                    <span className="font-medium">The gateway answers 502:</span> it cannot reach
                    the address you gave as the application&apos;s own.
                  </li>
                </ul>
              </details>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
