"use client"

import { useState } from "react"

import { ThreatFields, type ThreatForm, atlasOf, emptyForm, formProblems } from "@/components/threat-models/threat-fields"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { KIND_LABEL, type ThreatComponent, type ThreatNew } from "@/lib/threat-models"

const NEW_OUTPUT = "new-output"
const keyOf = (component: Pick<ThreatComponent, "kind" | "name">) => `${component.kind}::${component.name}`

/** UC-3.2 step 3: a threat the generation missed. It needs a component of the target (or a new
 * output channel) and at least one OWASP category (3a). */
export function AddThreatDialog({
  open,
  components,
  onClose,
  onAdd,
}: {
  open: boolean
  components: ThreatComponent[]
  onClose: () => void
  onAdd: (threat: ThreatNew) => void
}) {
  const [form, setForm] = useState<ThreatForm>(emptyForm)
  const [component, setComponent] = useState("")
  const [output, setOutput] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})

  function close(next: boolean) {
    if (next) return
    setForm(emptyForm())
    setComponent("")
    setOutput("")
    setErrors({})
    onClose()
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const problems = formProblems(form)
    const chosen = components.find((c) => keyOf(c) === component)
    if (!component) problems.component = "Choose the component the threat applies to."
    if (component === NEW_OUTPUT && output.trim().length < 2) problems.output = "Name the output, e.g. E-mail summary."
    setErrors(problems)
    if (Object.keys(problems).length) return
    onAdd({
      title: form.title.trim(),
      component_kind: chosen ? chosen.kind : "output",
      component_name: chosen ? chosen.name : output.trim(),
      owasp: form.owasp,
      atlas: atlasOf(form),
      likelihood: form.likelihood,
      impact: form.impact,
      reason: form.reason.trim(),
    })
    close(false)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Add threat</DialogTitle>
            <DialogDescription>
              It is added to your changes and becomes part of the next version when you save.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="add-component">Component</Label>
              <Select value={component} onValueChange={setComponent}>
                <SelectTrigger
                  id="add-component"
                  className="h-9 w-full"
                  aria-invalid={errors.component ? true : undefined}
                  aria-describedby={errors.component ? "add-component-error" : undefined}
                >
                  <SelectValue placeholder="Choose a component" />
                </SelectTrigger>
                <SelectContent>
                  {components.map((c) => (
                    <SelectItem key={keyOf(c)} value={keyOf(c)}>
                      {c.kind === "model" || c.kind === "system_prompt" ? c.name : `${KIND_LABEL[c.kind]}: ${c.name}`}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_OUTPUT}>A new output…</SelectItem>
                </SelectContent>
              </Select>
              {errors.component && (
                <p id="add-component-error" className="text-xs text-destructive">
                  {errors.component}
                </p>
              )}
            </div>
            {component === NEW_OUTPUT && (
              <div className="space-y-1.5">
                <Label htmlFor="add-output">Output name</Label>
                <Input
                  id="add-output"
                  value={output}
                  onChange={(event) => setOutput(event.target.value)}
                  maxLength={120}
                  placeholder="E-mail summary"
                  className="h-9"
                  aria-invalid={errors.output ? true : undefined}
                  aria-describedby={errors.output ? "add-output-error" : "add-output-hint"}
                />
                {errors.output ? (
                  <p id="add-output-error" className="text-xs text-destructive">
                    {errors.output}
                  </p>
                ) : (
                  <p id="add-output-hint" className="text-xs text-muted-foreground">
                    A channel the target&apos;s answers reach, besides its chat replies.
                  </p>
                )}
              </div>
            )}
            <ThreatFields
              id="add"
              form={form}
              onChange={(change) => setForm((current) => ({ ...current, ...change }))}
              errors={errors}
              reasonLabel="Note (optional)"
              reasonHint="Why it applies, e.g. a channel added recently. Shown when versions are compared."
            />
          </div>
          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" className="hover:bg-primary-hover">
              Add threat
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
