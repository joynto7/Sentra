"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Command } from "cmdk"
import { Search } from "lucide-react"

import { SeverityShape } from "@/components/sentra/severity-badge"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { ApiError } from "@/lib/api"
import {
  MIN_SEARCH_LENGTH,
  campaignHref,
  campaignLabel,
  search,
  type SearchResults,
} from "@/lib/search"
import { ENVIRONMENT_LABEL } from "@/lib/targets"

const WAIT_MS = 200 // for a pause in typing, so one word doesn't become ten requests
const HINT = "a name, or a code such as F-12, C-231 or R-231-4"

const GROUP =
  "mb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
const ROW =
  "flex cursor-pointer items-center gap-2.5 rounded-[7px] px-2 py-2 text-[13px] data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"

function heading(title: string, shown: number, total: number) {
  return total > shown ? `${title} (${shown} of ${total})` : title
}

/**
 * The search of the top bar: a dialog with one combobox. cmdk gives the keyboard and the roles of the
 * APG combobox pattern: the focus stays in the box, the arrow keys move through the results, Enter
 * opens one and Esc closes the dialog, which gives the focus back to where it was.
 */
export default function SearchDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [words, setWords] = useState("")
  const [results, setResults] = useState<SearchResults | null>(null)
  const [state, setState] = useState<"idle" | "searching" | "done" | "failed">("idle")
  const [problem, setProblem] = useState("")
  // Where the focus goes back to when the dialog closes: the dialog has no trigger of its own.
  const [opener] = useState(() => document.activeElement as HTMLElement | null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const running = useRef<AbortController>(undefined)

  useEffect(
    () => () => {
      clearTimeout(timer.current)
      running.current?.abort()
    },
    [],
  )

  async function find(value: string) {
    const controller = new AbortController()
    running.current = controller
    try {
      const found = await search(value, controller.signal)
      if (controller.signal.aborted) return
      setResults(found)
      setState("done")
    } catch (error) {
      if (controller.signal.aborted) return
      setResults(null)
      setProblem(
        error instanceof ApiError && error.status === 429
          ? error.message
          : "Search isn't available right now. Try again in a moment.",
      )
      setState("failed")
    }
  }

  function change(value: string) {
    setWords(value)
    clearTimeout(timer.current)
    running.current?.abort()
    if (value.trim().length < MIN_SEARCH_LENGTH) {
      setResults(null)
      setState("idle")
      return
    }
    setState("searching")
    timer.current = setTimeout(() => void find(value), WAIT_MS)
  }

  function open(href: string) {
    onClose()
    router.push(href)
  }

  const count = results
    ? results.targets.total + results.findings.total + results.campaigns.total
    : 0
  const told =
    state === "searching"
      ? "Searching"
      : state === "failed"
        ? problem
        : state === "done"
          ? count === 0
            ? "No results"
            : `${count} ${count === 1 ? "result" : "results"}`
          : ""

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          opener?.focus()
        }}
        className="top-[12%] block max-h-[76vh] translate-y-0 gap-0 overflow-hidden bg-card p-0 sm:max-w-[640px]"
      >
        <DialogTitle className="sr-only">Search targets, findings and campaigns</DialogTitle>
        <Command shouldFilter={false} loop label="Search targets, findings and campaigns">
          <div className="flex items-center gap-2.5 border-b px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Command.Input
              value={words}
              onValueChange={change}
              maxLength={100}
              placeholder="Search targets, findings, campaigns"
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground focus-visible:shadow-[inset_0_-2px_0_var(--ring)]"
            />
            <kbd className="rounded border px-1.5 font-mono text-[11px] text-muted-foreground">Esc</kbd>
          </div>
          {/* What a screen reader hears while the list changes around it. */}
          <div role="status" className="sr-only">
            {told}
          </div>
          {/* Beside the list, not in it: a listbox may hold only its options. */}
          {state === "idle" && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Type at least two letters of {HINT}.
            </p>
          )}
          {state === "failed" && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">{problem}</p>
          )}
          {state === "searching" && !results && (
            <p className="skeleton px-4 py-8 text-center text-sm text-muted-foreground">Searching…</p>
          )}
          {state === "done" && count === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm font-medium">
                Nothing matches <span className="break-words">&ldquo;{words.trim()}&rdquo;</span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">Try {HINT}.</p>
            </div>
          )}
          <Command.List className="max-h-[60vh] overflow-y-auto px-2 has-[[cmdk-group]]:py-2">
            {results && results.targets.items.length > 0 && (
              <Command.Group
                className={GROUP}
                heading={heading("Targets", results.targets.items.length, results.targets.total)}
              >
                {results.targets.items.map((hit) => (
                  <Command.Item
                    key={hit.id}
                    value={`target-${hit.id}`}
                    className={ROW}
                    onSelect={() => open(`/targets/${hit.id}`)}
                  >
                    <span className="truncate font-medium">{hit.name}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {hit.endpoint_host}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {hit.status === "archived" ? "Archived" : ENVIRONMENT_LABEL[hit.environment]}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {results && results.findings.items.length > 0 && (
              <Command.Group
                className={GROUP}
                heading={heading("Findings", results.findings.items.length, results.findings.total)}
              >
                {results.findings.items.map((hit) => (
                  <Command.Item
                    key={hit.code}
                    value={`finding-${hit.code}`}
                    className={ROW}
                    onSelect={() => open(`/findings/${hit.code}`)}
                  >
                    <SeverityShape severity={hit.severity} />
                    <span className="sr-only">{hit.severity}</span>
                    <span className="shrink-0 font-mono text-xs">{hit.code}</span>
                    <span className="truncate">{hit.title}</span>
                    <span className="ml-auto max-w-[35%] shrink-0 truncate text-xs text-muted-foreground">
                      {hit.target_name}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {results && results.campaigns.items.length > 0 && (
              <Command.Group
                className={GROUP}
                heading={heading("Campaigns", results.campaigns.items.length, results.campaigns.total)}
              >
                {results.campaigns.items.map((hit) => (
                  <Command.Item
                    key={campaignHref(hit)}
                    value={`campaign-${campaignLabel(hit)}`}
                    className={ROW}
                    onSelect={() => open(campaignHref(hit))}
                  >
                    <span className="shrink-0 font-mono text-xs">{campaignLabel(hit)}</span>
                    <span className="truncate">{hit.name}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
