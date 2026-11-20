"use client"

import { ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

/** A list filter as a button showing its current choice ("Type  All"); "" means all. */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
  allLabel = "All",
  changed,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  /** The name of the "" choice, e.g. "All users"; null for a filter that always has a value. */
  allLabel?: string | null
  /** Whether the choice differs from the default, which marks it; by default every choice but "". */
  changed?: boolean
}) {
  const current = options.find((o) => o.value === value)?.label ?? allLabel ?? ""
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-9 gap-1.5 px-3 font-normal" aria-label={`${label}: ${current}`}>
          <span className="text-muted-foreground">{label}</span>
          <span className={cn("font-medium", (changed ?? value !== "") && "text-link")}>{current}</span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {allLabel !== null && <DropdownMenuRadioItem value="">{allLabel}</DropdownMenuRadioItem>}
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
