"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import { FormField } from "@/components/auth/form-field"
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, fieldErrors } from "@/lib/api"
import { type SuiteItem, type TestDetail, getSuite, listSuites, saveSuiteVersion } from "@/lib/test-library"
import { cn } from "@/lib/utils"

/**
 * Screen 30, "Add to suite": puts the test into one of the organization's suites, which saves a
 * new version of that suite with the reason (UC-4.5). Built-in suites are read-only, so they are
 * not offered.
 */
export function AddToSuiteDialog({
  test,
  open,
  onOpenChange,
  onAdded,
}: {
  test: TestDetail
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: () => void
}) {
  const [suites, setSuites] = useState<SuiteItem[] | null>(null)
  const [choice, setChoice] = useState("")
  const [reason, setReason] = useState(`Added ${test.code} ${test.name}`.slice(0, 200))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const included = new Set(test.suites.map((s) => s.code))

  useEffect(() => {
    if (!open) return
    listSuites()
      .then((all) => setSuites(all.filter((s) => s.origin === "custom")))
      .catch(() => setSuites([]))
  }, [open])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const found: Record<string, string> = {}
    if (!choice) found.suite = "Choose a suite."
    if (reason.trim().length < 3) found.reason = "Describe the reason for the change."
    setErrors(found)
    if (Object.keys(found).length) return
    setPending(true)
    try {
      const suite = await getSuite(choice)
      await saveSuiteVersion(
        choice,
        { name: suite.name, purpose: suite.purpose, tests: [...suite.test_codes, test.code] },
        reason.trim(),
      )
      toast.success(`${test.code} added to ${suite.name}`, { description: `Saved as version ${suite.version + 1} of the suite.` })
      onAdded()
      onOpenChange(false)
    } catch (error) {
      const fields = fieldErrors(error)
      setErrors(
        Object.keys(fields).length
          ? { suite: Object.values(fields).join(" ") }
          : { suite: error instanceof ApiError ? error.message : "Something went wrong. Try again." },
      )
    } finally {
      setPending(false)
    }
  }

  const available = suites?.filter((s) => !included.has(s.code)) ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
        <form onSubmit={submit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>Add {test.code} to a suite</DialogTitle>
            <DialogDescription>
              Adding saves a new version of the suite. Built-in suites are read-only, so only your organization&apos;s suites
              are listed.
            </DialogDescription>
          </DialogHeader>

          {!suites ? (
            <p className="text-sm text-muted-foreground" role="status">
              Loading your suites…
            </p>
          ) : suites.length === 0 ? (
            <div className="space-y-3 rounded-[10px] border border-dashed p-4 text-sm">
              <p>Your organization has no suites of its own yet.</p>
              <Button asChild variant="outline" className="h-9">
                <Link href={`/test-library/suites/new?test=${encodeURIComponent(test.code)}`}>Create a suite with this test</Link>
              </Button>
            </div>
          ) : (
            <fieldset className="space-y-2" aria-describedby={errors.suite ? "suite-choice-error" : undefined}>
              <legend className="mb-2 text-sm font-medium">Suite</legend>
              <RadioGroup value={choice} onValueChange={setChoice} className="grid gap-2">
                {suites.map((suite) => {
                  const already = included.has(suite.code)
                  return (
                    <label
                      key={suite.code}
                      htmlFor={`suite-${suite.code}`}
                      className={cn(
                        "flex items-start gap-3 rounded-[10px] border p-3",
                        already ? "opacity-70" : "cursor-pointer hover:border-border-strong",
                        choice === suite.code && "border-primary bg-accent/60 ring-1 ring-primary",
                      )}
                    >
                      <RadioGroupItem id={`suite-${suite.code}`} value={suite.code} disabled={already} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{suite.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {already ? "Already includes this test" : `${suite.test_count} tests · version ${suite.version}`}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </RadioGroup>
              {errors.suite && (
                <p id="suite-choice-error" className="text-xs text-destructive">
                  {errors.suite}
                </p>
              )}
            </fieldset>
          )}

          {suites && suites.length > 0 && available.length === 0 && (
            <p className="text-sm">
              Every suite of your organization already includes this test.{" "}
              <Link href={`/test-library/suites/new?test=${encodeURIComponent(test.code)}`} className="font-medium text-link hover:underline">
                Create a new suite with it
              </Link>
            </p>
          )}

          {available.length > 0 && (
            <FormField id="add-reason" label="Reason for the change" error={errors.reason}>
              <Textarea
                id="add-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={200}
                rows={2}
                aria-invalid={!!errors.reason || undefined}
                aria-describedby={errors.reason ? "add-reason-error" : undefined}
              />
            </FormField>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="h-9">
                Cancel
              </Button>
            </DialogClose>
            {available.length > 0 && (
              <Button type="submit" className="h-9 hover:bg-primary-hover" disabled={pending}>
                {pending ? "Adding…" : "Add to suite"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
