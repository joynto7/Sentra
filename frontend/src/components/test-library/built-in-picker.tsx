"use client"

import { useEffect, useState } from "react"
import { Search } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { apiFetch } from "@/lib/api"
import type { Catalogue, TestSummary } from "@/lib/test-library"

/** "Start from a built-in test" (UC-4.2, 1a): pick the test whose copy fills the form. */
export function BuiltInPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (code: string) => void
}) {
  const [tests, setTests] = useState<TestSummary[] | null>(null)
  const [search, setSearch] = useState("")

  useEffect(() => {
    if (!open || tests) return
    apiFetch<Catalogue>("/v1/test-definitions?origin=built_in&page_size=100")
      .then((result) => setTests(result.items))
      .catch(() => setTests([]))
  }, [open, tests])

  const text = search.trim().toLowerCase()
  const shown = (tests ?? []).filter(
    (t) => !text || t.name.toLowerCase().includes(text) || t.code.toLowerCase().includes(text),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Start from a built-in test</DialogTitle>
          <DialogDescription>A copy of its definition replaces what the form holds now. You then adapt it.</DialogDescription>
        </DialogHeader>
        <label className="relative block">
          <span className="sr-only">Search built-in tests</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or ID"
            className="h-9 w-full rounded-[7px] border border-input bg-card pr-3 pl-8 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        </label>
        {!tests ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading the built-in tests…
          </p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No built-in test matches.</p>
        ) : (
          <ul className="divide-y rounded-[10px] border" aria-label="Built-in tests">
            {shown.map((test) => (
              <li key={test.code}>
                <button
                  type="button"
                  onClick={() => onPick(test.code)}
                  className="flex w-full items-baseline gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                >
                  <span className="w-28 shrink-0 font-mono text-xs">{test.code}</span>
                  <span className="flex-1">{test.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{test.category}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
