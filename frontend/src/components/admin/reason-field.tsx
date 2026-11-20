import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

export const REASON_MAX = 300

/** The required reason of a suspension (UC-10.2 step 1, quality requirement 6): it is recorded
 * in the audit log with who suspended the account. */
export function ReasonField({
  id,
  value,
  onChange,
  error,
  placeholder,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  error?: string
  placeholder?: string
}) {
  const length = value.trim().length
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Reason</Label>
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={REASON_MAX + 50}
        required
        rows={3}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
        className="min-h-20"
      />
      <div className="flex items-start justify-between gap-3 text-xs">
        <p id={`${id}-hint`} className="text-muted-foreground">
          Recorded in the audit log with your name.
        </p>
        <span className={cn("tabular shrink-0", length > REASON_MAX ? "font-medium text-destructive" : "text-muted-foreground")}>
          {length} / {REASON_MAX}
        </span>
      </div>
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
