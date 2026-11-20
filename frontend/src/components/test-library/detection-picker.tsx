"use client"

import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DETECTION_LABEL, DETECTION_ROLE_LABEL, type Detection } from "@/lib/test-library"

const ORDER = Object.keys(DETECTION_LABEL)

/** Detection methods in one fixed order, so the same choice always saves the same definition. */
export function sortMethods(methods: Detection[]): Detection[] {
  return [...methods].sort((a, b) => ORDER.indexOf(a.method) - ORDER.indexOf(b.method))
}

/** Adds a method with the role it most likely needs: decisive if none is decisive yet. */
export function withMethod(methods: Detection[], method: string): Detection[] {
  if (methods.some((d) => d.method === method)) return methods
  const role = methods.some((d) => d.role === "decisive") ? "supporting" : "decisive"
  return sortMethods([...methods, { method, role }])
}

/** The detection methods of a test, each with its role (UC-4.2 step 3). */
export function DetectionPicker({
  value,
  onChange,
  error,
}: {
  value: Detection[]
  onChange: (value: Detection[]) => void
  error?: string
}) {
  return (
    <fieldset
      id="detection_methods"
      aria-describedby={error ? "detection_methods-help detection_methods-error" : "detection_methods-help"}
      className="space-y-2"
    >
      <legend className="text-sm font-medium">Detection methods</legend>
      <p id="detection_methods-help" className="text-xs text-muted-foreground">
        At least one must be decisive: enough on its own to decide that the test succeeded.
      </p>
      <ul className="divide-y rounded-[10px] border">
        {ORDER.map((method) => {
          const chosen = value.find((d) => d.method === method)
          const label = DETECTION_LABEL[method]
          return (
            <li key={method} className="flex min-h-12 items-center gap-3 px-3 py-1.5">
              <Checkbox
                id={`method-${method}`}
                checked={!!chosen}
                onCheckedChange={(on) =>
                  onChange(on ? withMethod(value, method) : value.filter((d) => d.method !== method))
                }
              />
              <label htmlFor={`method-${method}`} className="flex-1 py-1.5 text-sm">
                {label}
              </label>
              {chosen && (
                <Select
                  value={chosen.role}
                  onValueChange={(role) => onChange(value.map((d) => (d.method === method ? { ...d, role } : d)))}
                >
                  <SelectTrigger aria-label={`Role of ${label}`} className="h-8 w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(DETECTION_ROLE_LABEL).map(([role, roleLabel]) => (
                      <SelectItem key={role} value={role}>
                        {roleLabel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </li>
          )
        })}
      </ul>
      {error && (
        <p id="detection_methods-error" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  )
}
