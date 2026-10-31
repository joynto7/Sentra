"use client"

import { useEffect, useState } from "react"

import { Skeleton } from "@/components/ui/skeleton"
import { type RemediationVersion, getRemediation } from "@/lib/remediation"

/** A fix of one version beside the other version's, matched by its title. */
function Column({ version, other }: { version: RemediationVersion; other: RemediationVersion }) {
  const elsewhere = new Set(other.fixes.map((fix) => fix.title.trim().toLowerCase()))
  return (
    <div className="min-w-0 flex-1">
      <h3 className="text-[13px] font-medium">
        Version {version.version}
        <span className="font-normal text-muted-foreground">
          {" "}
          · {version.edited_by ? `adapted by ${version.edited_by}` : "written by Sentra"}
        </span>
      </h3>
      <dl className="mt-2 space-y-2 text-[13px]">
        <div>
          <dt className="text-muted-foreground">Root cause</dt>
          <dd>{version.root_cause}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">What the fixes do</dt>
          <dd>{version.summary}</dd>
        </div>
      </dl>
      <ol className="mt-2 space-y-2">
        {version.fixes.map((fix) => {
          const alone = !elsewhere.has(fix.title.trim().toLowerCase())
          return (
            <li
              key={fix.position}
              className={`rounded-[7px] border p-2 text-[13px] ${alone ? "border-primary/50" : ""}`}
            >
              <span className="block font-medium">
                {fix.position}. {fix.title}
              </span>
              <span className="block text-muted-foreground">{fix.kind_label}</span>
              {alone && (
                <span className="mt-1 block text-xs text-primary">
                  Only in version {version.version}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/**
 * Two versions of a proposal beside each other (Screen 46), so a reader sees what a person
 * changed before they approve it. Fixes are matched by their title: one that was renamed shows
 * up in both columns as its own fix.
 */
export function VersionCompare({
  code,
  current,
  earlier,
}: {
  code: string
  current: RemediationVersion
  /** The version `current` was built on. */
  earlier: number
}) {
  const [before, setBefore] = useState<RemediationVersion | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getRemediation(code, earlier, controller.signal)
      .then((page) => setBefore(page.current))
      .catch(() => !controller.signal.aborted && setFailed(true))
    return () => controller.abort()
  }, [code, earlier])

  if (failed) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Version {earlier} could not be loaded, so there is nothing to compare with.
      </p>
    )
  }
  if (!before) {
    return <Skeleton className="h-32 w-full" role="status" aria-label="Loading the comparison" />
  }
  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <Column version={before} other={current} />
      <Column version={current} other={before} />
    </div>
  )
}
