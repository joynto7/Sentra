"use client"

import { RotateCcw, X } from "lucide-react"

import { FilterSelect } from "@/components/sentra/filter-select"
import { Button } from "@/components/ui/button"
import { PERIODS } from "@/lib/risk"

export const DEFAULT_DAYS = "90"

/** When a chip or "Reset filters" takes itself away, the keyboard goes to the first filter, not to the top of the page. */
export function focusFilters() {
  requestAnimationFrame(() => document.querySelector<HTMLElement>("#dashboard-filters button")?.focus())
}

type Option = { value: string; label: string }

/**
 * The dashboard's three filters, Target, Period and Category, and under them what is chosen, each
 * choice with a button that takes it away. Nothing about what a filter means is here: the page
 * asks the API with these three values and puts them in its address.
 */
export function DashboardFilters({
  target,
  days,
  category,
  targets,
  categories,
  onTarget,
  onDays,
  onCategory,
  onReset,
}: {
  target: string
  days: string
  category: string
  targets: Option[]
  categories: Option[]
  onTarget: (value: string) => void
  onDays: (value: string) => void
  onCategory: (value: string) => void
  onReset: () => void
}) {
  const chosen = [
    target && { key: "target", label: `Target: ${targets.find((one) => one.value === target)?.label ?? "one target"}`, clear: () => onTarget("") },
    days !== DEFAULT_DAYS && { key: "days", label: PERIODS.find((one) => one.value === days)?.label ?? `Last ${days} days`, clear: () => onDays(DEFAULT_DAYS) },
    category && { key: "category", label: `Category: ${categories.find((one) => one.value === category)?.label ?? category}`, clear: () => onCategory("") },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[]
  return (
    <div id="dashboard-filters" className="mb-4" role="group" aria-label="Dashboard filters">
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Target"
          value={target}
          onChange={onTarget}
          options={targets}
          allLabel={`All targets${targets.length ? ` (${targets.length})` : ""}`}
        />
        <FilterSelect label="Period" value={days} onChange={onDays} options={PERIODS} allLabel={null} changed={days !== DEFAULT_DAYS} />
        <FilterSelect label="Category" value={category} onChange={onCategory} options={categories} allLabel="All OWASP categories" />
        {chosen.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => {
              onReset()
              focusFilters()
            }}
          >
            <RotateCcw aria-hidden="true" />
            Reset filters
          </Button>
        )}
      </div>
      {chosen.length > 0 && (
        <ul className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Chosen filters">
          {chosen.map((one) => (
            <li key={one.key}>
              <span className="inline-flex min-h-7 items-center gap-1 rounded-full border bg-accent py-0.5 pr-1 pl-3 text-xs font-medium text-accent-foreground">
                {one.label}
                <button
                  type="button"
                  onClick={() => {
                    one.clear()
                    focusFilters()
                  }}
                  aria-label={`Remove the filter ${one.label}`}
                  className="grid size-6 place-items-center rounded-full hover:bg-background/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
