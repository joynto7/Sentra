import { Checkbox } from "@/components/ui/checkbox"

/** One option of a filter: what it filters by, and how Screen 29 writes it. */
type Option = {
  value: string
  label: string
  /** A category's code, written above its name ("LLM01" over "Prompt Injection") */
  code?: string
  /** A mark before the label, such as a severity's shape */
  icon?: React.ReactNode
  /** A line under the label, such as "Halcyon Bank only" */
  hint?: string
}

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
  options: Option[]
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
          <div key={option.value} className="flex items-start gap-2">
            <Checkbox
              id={id}
              className="mt-0.5"
              checked={selected.includes(option.value)}
              onCheckedChange={() => onToggle(option.value)}
            />
            <label htmlFor={id} className="flex min-h-6 flex-1 items-start justify-between gap-2 text-sm">
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  {option.icon}
                  {option.code ? <span className="font-mono text-xs font-semibold">{option.code}</span> : option.label}
                </span>
                {option.code && <span className="block text-[13px] text-text-secondary">{option.label}</span>}
                {option.hint && <span className="block text-xs text-muted-foreground">{option.hint}</span>}
              </span>
              <span className="tabular text-xs text-muted-foreground">{counts?.[option.value] ?? 0}</span>
            </label>
          </div>
        )
      })}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </fieldset>
  )
}
