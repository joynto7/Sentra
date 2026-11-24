"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { CircleCheck, Lock, Minus } from "lucide-react"

import { AtlasId, OwaspId } from "@/components/sentra/framework-ids"
import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import { useSession } from "@/components/session-provider"
import { AddToSuiteDialog } from "@/components/test-library/add-to-suite-dialog"
import { RetireDialog } from "@/components/test-library/retire-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError, apiFetch } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import {
  DETECTION_LABEL,
  DETECTION_ROLE_LABEL,
  ORIGIN_LABEL,
  type TestDetail,
  TARGET_TYPE_LABEL,
  formatDate,
} from "@/lib/test-library"
import { cn } from "@/lib/utils"

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <div className="text-sm text-text-secondary">{children}</div>
    </section>
  )
}

/** Screen 30: one test definition, current or an earlier version (UC-4.1 steps 5–6, alternative 6a). */
export function TestDefinitionView({ code, version }: { code: string; version?: number }) {
  const organization = useSession().organization?.name ?? "your organization"
  const canManage = useCan("manage_custom_tests")
  const canBuild = useCan("manage_test_suites")
  const [test, setTest] = useState<TestDetail | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [retiring, setRetiring] = useState(false)
  const [adding, setAdding] = useState(false)

  usePageCrumbs(version ? [{ label: code, href: `/test-library/${code}` }, { label: `v${version}` }] : [{ label: code }])

  const load = useCallback(() => {
    const path = version
      ? `/v1/test-definitions/${encodeURIComponent(code)}/versions/${version}`
      : `/v1/test-definitions/${encodeURIComponent(code)}`
    apiFetch<TestDetail>(path)
      .then(setTest)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) setNotFound(true)
      })
  }, [code, version])
  useEffect(load, [load])

  if (notFound) {
    return (
      <EmptyState
        title="Test definition not found"
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
  const custom = test.origin === "custom"
  const duplicate = `/test-library/new?from=${encodeURIComponent(test.code)}`

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{test.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm">{test.code}</span>
            <Badge variant="secondary" className="font-normal">
              {ORIGIN_LABEL[test.origin] ?? test.origin}
            </Badge>
            {custom && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="size-3.5" aria-hidden="true" />
                {organization} only
              </span>
            )}
            <Badge variant="outline" className="font-normal">
              v{test.version} · {test.is_current ? "current" : "earlier version"}
            </Badge>
            {test.retired && (
              <Badge variant="outline" className="border-warning/60 font-normal text-warning">
                Retired
              </Badge>
            )}
            <SeverityBadge severity={test.severity} />
          </div>
        </div>
        {(canManage || canBuild) && test.is_current && (
          <div className="flex flex-wrap gap-2">
            {canManage && custom && !test.retired && (
              <Button asChild className="h-9 hover:bg-primary-hover">
                <Link href={`/test-library/${encodeURIComponent(test.code)}/edit`}>Edit</Link>
              </Button>
            )}
            {canManage && !custom && (
              <Button asChild className="h-9 hover:bg-primary-hover">
                <Link href={duplicate}>Duplicate as custom test</Link>
              </Button>
            )}
            {canBuild && !test.retired && (
              <Button variant="outline" className="h-9" onClick={() => setAdding(true)}>
                Add to suite
              </Button>
            )}
            {canManage && custom && (
              <Button asChild variant="outline" className="h-9">
                <Link href={duplicate}>Duplicate</Link>
              </Button>
            )}
            {canManage && custom && !test.retired && (
              <Button variant="outline" className="h-9 text-destructive" onClick={() => setRetiring(true)}>
                Retire
              </Button>
            )}
          </div>
        )}
      </div>

      {!test.is_current ? (
        <Alert>
          <AlertDescription>
            You&apos;re viewing version {test.version}, which is no longer current.{" "}
            <Link href={`/test-library/${test.code}`} className="font-medium text-link hover:underline">
              View the current version
            </Link>
          </AlertDescription>
        </Alert>
      ) : test.retired ? (
        <Alert>
          <AlertDescription>
            This test is retired: it&apos;s no longer in the catalogue or in future campaign runs. Past results still
            show it.
          </AlertDescription>
        </Alert>
      ) : (
        !custom && (
          <Alert>
            <AlertDescription>Built-in tests are read-only.</AlertDescription>
          </Alert>
        )
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5 rounded-[10px] border bg-card p-6">
          <Section title="Objective">{test.objective}</Section>
          <Section title="Prerequisites">{test.prerequisites}</Section>
          <Section title="Applicable target types">
            {test.target_types.map((t) => TARGET_TYPE_LABEL[t]).join(", ")}
          </Section>
          <Section title="Success condition">
            <p>{test.success_condition}</p>
            {test.success_rules.length > 0 && (
              <ul className="mt-2 space-y-1">
                {test.success_rules.map((rule, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                    <span>{rule.sentence}</span>
                    <span className="text-xs text-muted-foreground">checked by {DETECTION_LABEL[rule.method]}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
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
                    <span className="ml-auto text-xs text-muted-foreground">
                      {role ? DETECTION_ROLE_LABEL[role].toLowerCase() : "not used"}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="rounded-[10px] border bg-card p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Framework mapping</h2>
            <div className="space-y-2 text-sm">
              <OwaspId code={test.category} name={test.category_name} />
              {test.atlas.map((technique) => (
                <AtlasId key={technique} code={technique} className="block text-[13px]" />
              ))}
            </div>
          </section>

          <section className="rounded-[10px] border bg-card p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Used by</h2>
            {test.suites.length ? (
              <ul className="space-y-1.5 text-sm">
                {test.suites.map((suite) => (
                  <li key={suite.code} className="flex items-baseline gap-2">
                    <Link href={`/test-library/suites/${suite.code}`} className="text-link hover:underline">
                      {suite.name}
                    </Link>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {suite.origin === "custom" ? "Custom" : "Built-in"} · v{suite.version}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No test suite includes it yet.</p>
            )}
          </section>

          <section className="rounded-[10px] border bg-card p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Version history</h2>
            <ul className="space-y-2.5">
              {test.versions.map((v) => (
                <li key={v.version} className="text-sm">
                  <div className="flex items-baseline gap-2">
                    <Link
                      href={v.is_current ? `/test-library/${test.code}` : `/test-library/${test.code}?version=${v.version}`}
                      className={cn("font-medium hover:underline", v.version === test.version ? "text-foreground" : "text-link")}
                      aria-current={v.version === test.version ? "page" : undefined}
                    >
                      v{v.version}
                      {v.is_current ? " · current" : ""}
                    </Link>
                    {v.retired && <span className="text-xs text-warning">retired</span>}
                    <span className="ml-auto text-xs text-muted-foreground">{formatDate(v.created_at)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{v.change_note}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {retiring && (
        <RetireDialog test={test} open={retiring} onOpenChange={setRetiring} onRetired={(retired) => setTest(retired)} />
      )}
      {adding && <AddToSuiteDialog test={test} open={adding} onOpenChange={setAdding} onAdded={load} />}
    </div>
  )
}
