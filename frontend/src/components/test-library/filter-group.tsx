import { Checkbox } from "@/components/ui/checkbox"

/** A group of checkbox filters, each with the number of tests it would match. */
export function FilterGroup({
  title,
  hint,
  options,
  selected,
  counts,
  onToggle,
}: {
  title: string
  hint?: string
  options: { value: string; label: string }[]
  selected: string[]
  counts: Record<string, number> | undefined
  onToggle: (value: string) => void
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</legend>
      {options.map((option) => {
        const id = `${title}-${option.value}`.replace(/\s+/g, "-").toLowerCase()
        return (
          <div key={option.value} className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={selected.includes(option.value)}
              onCheckedChange={() => onToggle(option.value)}
            />
            <label htmlFor={id} className="flex flex-1 items-center justify-between gap-2 text-sm">
              <span>{option.label}</span>
              <span className="tabular text-xs text-muted-foreground">{counts?.[option.value] ?? 0}</span>
            </label>
          </div>
        )
      })}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </fieldset>
  )
}
