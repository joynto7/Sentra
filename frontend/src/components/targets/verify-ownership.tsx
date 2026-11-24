"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { CircleCheck, CircleX, Info, Loader2 } from "lucide-react"

import { CopyButton } from "@/components/sentra/copy-button"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ApiError } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import {
  type OwnershipCheck,
  type Target,
  VERIFICATION_LABEL,
  type Verification,
  type VerificationMethod,
  formatDateTime,
  getOwnershipCheck,
  getVerification,
  startOwnershipCheck,
} from "@/lib/targets"

const POLL_MS = 1500
const MAX_POLLS = 40

/** One line of the instructions: a value with its own Copy button, so nothing is retyped. */
function ValueRow({ label, value, copyLabel }: { label: string; value: string; copyLabel: string }) {
  return (
    <div className="py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 font-mono text-[13px] break-all">{value}</span>
        <CopyButton text={value} description={copyLabel} />
      </dd>
    </div>
  )
}

/** The message for whoever administers the domain. The token is not a secret and gives no access. */
function instructions(host: string, verification: Verification): string {
  const dns = verification.dns
  return [
    `Please publish a verification token for Sentra on ${host}.`,
    "",
    ...(dns ? ["Add this DNS TXT record:", `  Name:  ${dns.name}`, `  Value: ${dns.value}`, ""] : []),
    "Or publish this file:",
    `  URL:     ${verification.file.url}`,
    `  Content: ${verification.file.content}`,
    "",
    "Sentra checks the token before every security test. It is not a secret and gives no access.",
  ].join("\n")
}

/** 4a and 4b: what Sentra looked at and what it found there. */
function Outcome({ check }: { check: OwnershipCheck }) {
  if (check.status === "passed") return null
  return (
    <div role="alert" className="rounded-[7px] border border-destructive/40 bg-destructive/5 p-3">
      <p className="flex items-start gap-2 text-sm text-destructive">
        <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {check.message ?? `Sentra looked at ${check.checked_location} and found no Sentra token.`}
      </p>
      {check.found && <p className="mt-2 font-mono text-xs break-all text-text-secondary">Found: {check.found}</p>}
    </div>
  )
}

/**
 * Screen 19's ownership card (UC-2.3 Verify Target Ownership): the target's token, both methods
 * and "Check now". Only a successful check sets the status to verified (NFR-8.1), and Sentra
 * checks the token again before every campaign run (FR-2.3).
 */
export function VerifyOwnership({
  target,
  onVerified,
  footer,
}: {
  target: Target
  onVerified?: () => void
  /** Buttons beside "Check now", such as "Finish later" in the registration wizard. */
  footer?: React.ReactNode
}) {
  const canVerify = useCan("verify_targets")
  const [verification, setVerification] = useState<Verification | null>(null)
  const [method, setMethod] = useState<VerificationMethod>("dns_txt_record")
  const [check, setCheck] = useState<OwnershipCheck | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [slow, setSlow] = useState(false)
  const polls = useRef(0)

  useEffect(() => {
    const controller = new AbortController()
    getVerification(target.id, controller.signal)
      .then((found) => {
        setVerification(found)
        setMethod(found.ip_endpoint || !found.dns ? "well_known_file" : "dns_txt_record")
        setCheck(found.recent_checks[0] ?? null)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [target.id])

  // A check runs on a worker, so the page follows it until it has passed or failed (step 4).
  useEffect(() => {
    if (check?.status !== "running" || slow) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      polls.current += 1
      if (polls.current > MAX_POLLS) {
        setSlow(true)
        return
      }
      getOwnershipCheck(target.id, check.id, controller.signal)
        .then(async (updated) => {
          setCheck(updated)
          if (updated.status !== "passed") return
          // Step 5: the target is verified; step 6 starts the mapping of its profile.
          const found = await getVerification(target.id).catch(() => null)
          if (found) setVerification(found)
          onVerified?.()
        })
        .catch(() => undefined)
    }, POLL_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [check, target.id, slow, onVerified])

  const startCheck = useCallback(async () => {
    setBusy(true)
    setProblem(null)
    setSlow(false)
    polls.current = 0
    try {
      setCheck(await startOwnershipCheck(target.id, method))
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "The check could not be started.")
    } finally {
      setBusy(false)
    }
  }, [target.id, method])

  if (!verification) {
    return (
      <section className="rounded-[10px] border bg-card p-5" role="status" aria-label="Loading the ownership check">
        <Skeleton className="h-6 w-72" />
        <Skeleton className="mt-3 h-24 w-full" />
      </section>
    )
  }

  if (verification.status === "verified") {
    return (
      <section aria-labelledby="ownership-heading" className="rounded-[10px] border border-success/40 bg-success/5 p-5">
        <h2 id="ownership-heading" className="flex items-center gap-2 text-[15px] font-semibold">
          <CircleCheck className="size-5 text-success" aria-hidden="true" />
          Ownership verified
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          {verification.method ? VERIFICATION_LABEL[verification.method] : "Checked"}
          {verification.verified_by ? ` · by ${verification.verified_by}` : ""}
          {verification.verified_at ? ` · ${formatDateTime(verification.verified_at)}` : ""}
        </p>
        <p className="mt-3 text-sm">
          {target.profile_status === "mapping"
            ? "Sentra is now mapping the Target Profile. It sends a few harmless discovery requests, which takes about two minutes."
            : "Sentra checks this token again before every campaign run."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link href={`/targets/${target.id}/profile`}>View Target Profile</Link>
          </Button>
          {footer}
        </div>
      </section>
    )
  }

  return (
    <section aria-labelledby="ownership-heading" className="rounded-[10px] border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="ownership-heading" className="text-[15px] font-semibold break-all">
          Verify ownership of <span className="font-mono text-sm">{target.endpoint_host}</span>
        </h2>
        <span className="inline-flex h-6 items-center rounded-md border border-dashed border-warning/60 px-2 text-xs font-medium text-warning">
          Not verified
        </span>
      </div>

      <p className="mt-2 text-sm text-text-secondary">
        Sentra tests only applications you control. Publish this token on the endpoint&apos;s domain, then check.
      </p>

      {verification.is_lab ? (
        <p className="mt-4 flex items-start gap-2 rounded-[7px] border bg-muted/40 p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          This is one of Sentra&apos;s own lab targets. Sentra places the token itself, so you only have to check.
        </p>
      ) : (
        <Tabs value={method} onValueChange={(value) => setMethod(value as VerificationMethod)} className="mt-4 gap-3">
          <TabsList
            variant="line"
            aria-label="Verification method"
            className="h-9 w-full justify-start gap-6 border-b px-0"
          >
            <TabsTrigger
              value="dns_txt_record"
              className="flex-none px-0.5"
              disabled={verification.ip_endpoint || !verification.dns}
            >
              DNS TXT record
            </TabsTrigger>
            <TabsTrigger value="well_known_file" className="flex-none px-0.5">
              Well-known file
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="dns_txt_record"
            className="space-y-2 rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {verification.dns && (
              <>
                <dl className="divide-y rounded-[7px] border px-3">
                  <ValueRow label="Type" value={verification.dns.type} copyLabel="Copy the record type" />
                  <ValueRow label="Name" value={verification.dns.name} copyLabel="Copy the record name" />
                  <ValueRow label="Value" value={verification.dns.value} copyLabel="Copy the record value" />
                </dl>
                <p className="text-xs text-muted-foreground">
                  DNS changes can take up to an hour. The token stays valid.
                </p>
              </>
            )}
          </TabsContent>

          <TabsContent
            value="well_known_file"
            className="space-y-2 rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <dl className="divide-y rounded-[7px] border px-3">
              <ValueRow label="File URL" value={verification.file.url} copyLabel="Copy the file address" />
              <ValueRow label="File content" value={verification.file.content} copyLabel="Copy the file content" />
            </dl>
            <p className="text-xs text-muted-foreground">
              {verification.ip_endpoint
                ? "This endpoint is an IP address, which has no DNS records, so only the file can be used."
                : "The file must be on the endpoint's own host and plain text."}
            </p>
          </TabsContent>
        </Tabs>
      )}

      <div aria-live="polite" className="mt-4 space-y-3">
        {check?.status === "running" && (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden="true" />
            Sentra is looking for the token at <span className="font-mono text-xs break-all">{check.checked_location}</span>
          </p>
        )}
        {check && check.status !== "running" && <Outcome check={check} />}
        {slow && <p className="text-sm text-warning">This is taking longer than usual. Check again.</p>}
        {problem && <p className="text-sm text-destructive">{problem}</p>}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {canVerify !== false && (
          <Button
            className="h-9 hover:bg-primary-hover"
            disabled={busy || check?.status === "running"}
            onClick={startCheck}
          >
            {check?.status === "running" ? "Checking…" : busy ? "Starting…" : "Check now"}
          </Button>
        )}
        {footer}
        {!verification.is_lab && (
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" className="h-9">
                Send these instructions to your infrastructure team
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[560px]">
              <DialogHeader>
                <DialogTitle>Instructions for your infrastructure team</DialogTitle>
                <DialogDescription>
                  Copy this message. It contains the token, which is not a secret and gives no access.
                </DialogDescription>
              </DialogHeader>
              <pre className="max-h-72 overflow-auto rounded-[7px] border bg-muted/40 p-3 font-mono text-xs break-words whitespace-pre-wrap">
                {instructions(target.endpoint_host, verification)}
              </pre>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" className="h-9">
                    Close
                  </Button>
                </DialogClose>
                <CopyButton
                  text={instructions(target.endpoint_host, verification)}
                  label="Copy message"
                  description="Copy the instructions"
                  className="h-9 gap-1.5"
                />
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {canVerify === false && (
        <p className="mt-3 text-xs text-muted-foreground">
          Only an AI Application Developer of your organization can run the check.
        </p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Re-checked before every run. Nobody can skip the check.</p>
    </section>
  )
}
