import { Label } from "@/components/ui/label"

/** Label, input and the error message under it (errors sit next to their field, NFR-4.5). */
export function FormField({
  id,
  label,
  error,
  labelAction,
  announce = false,
  children,
}: {
  id: string
  label: string
  error?: string
  labelAction?: React.ReactNode
  /** Read the error out at once, for a field whose error appears after the focus stays in it */
  announce?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {labelAction}
      </div>
      {children}
      {error && (
        <p id={`${id}-error`} role={announce ? "alert" : undefined} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
