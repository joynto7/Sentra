"use client"

import { useId, useMemo, useState } from "react"
import { Check, ChevronDown, Search } from "lucide-react"

import { RiskBandChip } from "@/components/sentra/risk-score"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { RiskBand } from "@/lib/risk"
import { initials } from "@/lib/session"
import { ENVIRONMENT_LABEL, type Environment, TYPE_LABEL, type TargetType } from "@/lib/targets"
import { cn } from "@/lib/utils"

export type PickerTarget = {
  id: string
  name: string
  type: string
  environment: string
  score: number | null
  band: RiskBand | null
  open: number
}

/** The initials of a target in a soft circle: the card's own avatar, smaller. */
export function TargetMark({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-[#c9d2fa] font-medium text-[#1f2f80] dark:bg-[#27406f] dark:text-[#d8e4ff]",
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}

function describe(target: PickerTarget) {
  const type = TYPE_LABEL[target.type as TargetType] ?? target.type
  const environment = ENVIRONMENT_LABEL[target.environment as Environment] ?? target.environment
  return `${type} · ${environment}`
}

/**
 * Choosing one target from the organization's: a button that shows the choice and opens a panel with
 * a search field and one row for each target (its type and environment, its score and band, its open
 * findings). It is a listbox that the keyboard drives from the search field: the arrows move, Enter
 * chooses, Escape closes (WAI-ARIA combobox pattern).
 */
export function TargetPicker({
  label = "Target",
  targets,
  value,
  onChange,
}: {
  label?: string
  targets: PickerTarget[]
  value: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [active, setActive] = useState(0)
  const listId = useId()
  const current = targets.find((target) => target.id === value)

  const shown = useMemo(() => {
    const words = search.trim().toLowerCase()
    return words
      ? targets.filter((target) => `${target.name} ${describe(target)}`.toLowerCase().includes(words))
      : targets
  }, [targets, search])

  function choose(target: PickerTarget) {
    onChange(target.id)
    setOpen(false)
  }

  const activeId = shown[active] ? `${listId}-${shown[active].id}` : undefined

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setSearch("")
          setActive(
            Math.max(
              0,
              targets.findIndex((target) => target.id === value),
            ),
          )
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-11 gap-2.5 px-3 font-normal"
          aria-label={`${label}: ${current?.name ?? "none chosen"}`}
          aria-haspopup="listbox"
        >
          {current && <TargetMark name={current.name} className="size-7 text-xs" />}
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium text-link">{current?.name ?? "Choose"}</span>
          {current && current.open > 0 && (
            <span className="tabular rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {current.open} open
            </span>
          )}
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))] p-0">
        <div className="relative border-b p-2">
          <Search
            className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-label="Search targets"
            placeholder="Search targets"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setActive(0)
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault()
                setActive((now) => Math.min(shown.length - 1, now + 1))
              } else if (event.key === "ArrowUp") {
                event.preventDefault()
                setActive((now) => Math.max(0, now - 1))
              } else if (event.key === "Home") {
                event.preventDefault()
                setActive(0)
              } else if (event.key === "End") {
                event.preventDefault()
                setActive(Math.max(0, shown.length - 1))
              } else if (event.key === "Enter" && shown[active]) {
                event.preventDefault()
                choose(shown[active])
              }
            }}
            className="h-9 w-full rounded-[7px] border border-input bg-card pr-3 pl-8 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        </div>
        <ul id={listId} role="listbox" aria-label={`${label}s`} className="max-h-80 overflow-y-auto p-1.5">
          {shown.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">No target matches.</li>
          )}
          {shown.map((target, index) => {
            const chosen = target.id === value
            return (
              <li
                key={target.id}
                id={`${listId}-${target.id}`}
                role="option"
                aria-selected={chosen}
                ref={(node) => {
                  if (node && index === active) node.scrollIntoView({ block: "nearest" })
                }}
                onMouseMove={() => setActive(index)}
                onClick={() => choose(target)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2",
                  index === active ? "bg-accent" : "",
                  chosen && "bg-primary/10",
                )}
              >
                <TargetMark name={target.name} className="size-9 text-sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{target.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{describe(target)}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {target.score !== null ? (
                    <span className="flex items-center gap-1.5">
                      <span className="tabular text-sm font-semibold">{target.score}</span>
                      <RiskBandChip band={target.band ?? "none"} />
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not scored</span>
                  )}
                  <span className="tabular text-xs text-muted-foreground">
                    {target.open > 0 ? `${target.open} open` : "None open"}
                  </span>
                </span>
                <Check
                  className={cn("size-4 shrink-0 text-primary", chosen ? "opacity-100" : "opacity-0")}
                  aria-hidden="true"
                />
              </li>
            )
          })}
        </ul>
        <p className="border-t px-3 py-2 text-xs text-muted-foreground" aria-live="polite">
          {shown.length} of {targets.length} {targets.length === 1 ? "target" : "targets"}
        </p>
      </PopoverContent>
    </Popover>
  )
}
