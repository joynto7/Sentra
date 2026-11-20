"use client"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

/** One choice out of a few, shown side by side ("Staging | Production"). Always has a value. */
export function SegmentedControl<T extends string>({
  id,
  value,
  options,
  onChange,
  describedBy,
  labelledBy,
  disabled,
}: {
  id?: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  describedBy?: string
  labelledBy?: string
  disabled?: boolean
}) {
  return (
    <ToggleGroup
      id={id}
      type="single"
      value={value}
      onValueChange={(next) => next && onChange(next as T)}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      variant="outline"
      disabled={disabled}
      className="h-9"
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} className="h-9 px-4 data-[state=on]:bg-accent data-[state=on]:font-semibold data-[state=on]:text-accent-foreground">
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
