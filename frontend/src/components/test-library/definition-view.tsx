"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CircleCheck, Minus } from "lucide-react"

import { EmptyState } from "@/components/layout/empty-state"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError, apiFetch } from "@/lib/api"
import { DETECTION_LABEL, ORIGIN_LABEL, type TestDetail, TARGET_TYPE_LABEL, formatDate } from "@/lib/test-library"
import { cn } from "@/lib/utils"

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <div className="text-sm text-text-secondary">{children}</div>
    </section>
  )
}

/** One test definition, current or an earlier version (UC-4.1 steps 5–6, alternative 6a). */
export function TestDefinitionView({ code, version }: { code: string; version?: number }) {
  const [test, setTest] = useState<TestDetail | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    const path = version
      ? `/v1/test-definitions/${encodeURIComponent(code)}/versions/${version}`
      : `/v1/test-definitions/${encodeURIComponent(code)}`
    apiFetch<TestDetail>(path)
      .then(setTest)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) setNotFound(true)
      })
  }, [code, version])

  if (notFound) {
    return (
      <EmptyState
        title="Test definition not found"
        description="It may have been removed, or the address is wrong."
        action={
          <Link href="/test-library" className={cn(buttonVariants({ variant: "outline" }), "h-9")}>
            Back to the Test Library
          </Link>
        }
      />
    )
  }
  if (!test) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading test definition">
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const used = new Map(test.detection_methods.map((d) => [d.method, d.role]))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{test.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm">{test.code}</span>
          <Badge variant="secondary" className="font-normal">
            {ORIGIN_LABEL[test.origin] ?? test.origin}
          </Badge>
          <Badge variant="outline" className="font-normal">
            v{test.version} · {test.is_current ? "current" : "earlier version"}
          </Badge>
          <SeverityBadge severity={test.severity} />
        </div>
      </div>

      {test.is_current ? (
        <Alert>
          <AlertDescription>Built-in tests are read-only.</AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <AlertDescription>
            You&apos;re viewing version {test.version}, which is no longer current.{" "}
            <Link href={`/test-library/${test.code}`} className="font-medium text-link hover:underline">
              View the current version
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5 rounded-[10px] border bg-card p-6">
          <Section title="Objective">{test.objective}</Section>
          <Section title="Prerequisites">{test.prerequisites}</Section>
          <Section title="Applicable target types">
            {test.target_types.map((t) => TARGET_TYPE_LABEL[t]).join(", ")}
          </Section>
          <Section title="Success condition">{test.success_condition}</Section>
          <Section title="How attempts are built">
            Generated at run time from a safe template with synthetic content. Attempt text is not stored in
            the library. Template: <span className="font-mono text-xs">{test.attempt_template}</span>
          </Section>
          <Section title="Recommended mitigation">{test.recommended_mitigation}</Section>
        </div>

        <div className="space-y-5">
          <section className="rounded-[10px] border bg-card p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Detection methods</h2>
            <ul className="space-y-2">
              {Object.entries(DETECTION_LABEL).map(([method, label]) => {
                const role = used.get(method)
                return (
                  <li key={method} className="flex items-center gap-2 text-sm">
                    {role ? (
                      <CircleCheck className="size-4 text-success" aria-hidden="true" />
                    ) : (
                      <Minus className="size-4 text-muted-foreground" aria-hidden="true" />
                    )}
                    <span className={role ? "" : "text-muted-foreground"}>{label}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{role ?? "not used"}</span>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="rounded-[10px] border bg-card p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Framework mapping</h2>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className="font-normal">
                <span className="font-mono">{test.category}</span> {test.category_name}
              </Badge>
              {test.atlas.map((technique) => (
                <Badge key={technique} variant="outline" className="font-mono font-normal">
                  {technique}
                </Badge>
              ))}
            </div>
            {test.atlas.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">No MITRE ATLAS technique applies.</p>
            )}
          </section>

          <section className="rounded-[10px] border bg-card p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Version history</h2>
            <ul className="space-y-2">
              {test.versions.map((v) => (
                <li key={v.version} className="flex items-baseline gap-2 text-sm">
                  <Link
                    href={v.is_current ? `/test-library/${test.code}` : `/test-library/${test.code}?version=${v.version}`}
                    className={cn("font-medium hover:underline", v.version === test.version ? "text-foreground" : "text-link")}
                    aria-current={v.version === test.version ? "page" : undefined}
                  >
                    v{v.version}
                    {v.is_current ? " · current" : ""}
                  </Link>
                  <span className="text-xs text-muted-foreground">{formatDate(v.created_at)}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{v.change_note}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
