"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { FileUp, Library } from "lucide-react"
import { toast } from "sonner"

import { FormField } from "@/components/auth/form-field"
import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { SegmentedControl } from "@/components/sentra/segmented-control"
import { useSession } from "@/components/session-provider"
import { TemplateEditor } from "@/components/targets/template-editor"
import { BuiltInPicker } from "@/components/test-library/built-in-picker"
import { DetectionPicker, withMethod } from "@/components/test-library/detection-picker"
import { RuleBuilder } from "@/components/test-library/rule-builder"
import { ValidationPanel } from "@/components/test-library/validation-panel"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import {
  CATEGORIES,
  type CheckResult,
  type Definition,
  SEVERITIES,
  SEVERITY_LABEL,
  type Source,
  type SuccessRule,
  TARGET_TYPE_LABEL,
  type TestDetail,
  type Vocabulary,
  checkDefinition,
  conditionFrom,
  createCustomTest,
  emptyDefinition,
  getTest,
  getVocabulary,
  saveVersion,
  toDefinition,
} from "@/lib/test-library"

type Mode = "form" | "file"
type Problem = { field: string; message: string }

// The fields in the order of the form: after a failed save the focus goes to the first problem.
const FORM_ORDER = [
  "name",
  "category",
  "objective",
  "prerequisites",
  "target_types",
  "attempt_template",
  "success_rules",
  "success_condition",
  "detection_methods",
  "severity",
  "recommended_mitigation",
  "atlas",
  "file",
  "reason",
]

const atlasList = (text: string) => text.split(/[\s,]+/).filter(Boolean)
const describedBy = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(" ") || undefined

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-4 rounded-[10px] border bg-card p-6">
      <div>
        <h2 id={id} className="text-[15px] font-semibold">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

/**
 * Screen 31, the custom test editor: UC-4.2 Create Custom Test (with 1a "start from a built-in
 * test", 1b "upload a definition file", 5a and 5b) and UC-4.3 Update Custom Test, as a form or as
 * a definition file. The "Validation" panel checks the definition while the user types.
 */
export function CustomTestEditor({ code, from }: { code?: string; from?: string }) {
  const router = useRouter()
  const organization = useSession().organization?.name ?? "your organization"
  const canManage = useCan("manage_custom_tests")
  const editing = !!code
  const [vocab, setVocab] = useState<Vocabulary | null>(null)
  const [original, setOriginal] = useState<TestDetail | null>(null)
  const [ready, setReady] = useState(!code && !from)
  const [loadError, setLoadError] = useState<"not_found" | "failed" | null>(null)
  const [mode, setMode] = useState<Mode>("form")
  const [form, setForm] = useState<Definition>(emptyDefinition)
  const [atlasText, setAtlasText] = useState("")
  const [fileText, setFileText] = useState("")
  const [fileError, setFileError] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const [result, setResult] = useState<CheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [saveProblems, setSaveProblems] = useState<Problem[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [picking, setPicking] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [touched, setTouched] = useState(false)
  const leaving = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const checks = useMemo(() => vocab?.rule_checks ?? [], [vocab])
  const backTo = editing ? `/test-library/${code}` : "/test-library"

  usePageCrumbs(code ? [{ label: code, href: `/test-library/${code}` }, { label: "Edit" }] : [{ label: "New Custom Test" }])

  function fill(definition: Definition) {
    setForm(definition)
    setAtlasText(definition.atlas.join(", "))
  }

  useEffect(() => {
    getVocabulary()
      .then(setVocab)
      .catch(() => setLoadError("failed"))
  }, [])

  // Edit: the current version. "Duplicate as custom test" (?from=CODE): a copy (UC-4.2, 1a).
  useEffect(() => {
    const source = code ?? from
    if (!source) return
    getTest(source)
      .then((test) => {
        if (code) setOriginal(test)
        fill(code ? toDefinition(test) : copyOf(test))
        setReady(true)
      })
      .catch((error) => setLoadError(error instanceof ApiError && error.status === 404 ? "not_found" : "failed"))
  }, [code, from])

  const source = useMemo<Source>(
    () => (mode === "file" ? { file: fileText } : { definition: { ...form, atlas: atlasList(atlasText) } }),
    [mode, fileText, form, atlasText],
  )

  // The live "Validation" panel: checked by the API shortly after the user stops typing.
  useEffect(() => {
    if (canManage !== true || !ready) return
    let active = true
    const timer = setTimeout(() => {
      setChecking(true)
      checkDefinition(source)
        .then((checked) => active && setResult(checked))
        .catch(() => undefined)
        .finally(() => active && setChecking(false))
    }, 350)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [source, canManage, ready])

  useEffect(() => {
    if (!touched) return
    const warn = (event: BeforeUnloadEvent) => {
      if (!leaving.current) event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [touched])

  // Problems are shown next to their fields once the user has tried to save (NFR-4.5).
  const problems: Problem[] = useMemo(() => {
    if (!submitted) return []
    const live = result
      ? [...result.errors, ...result.rules.filter((r) => !r.ok && r.field).map((r) => ({ field: r.field, message: r.message }))]
      : []
    return [...live, ...saveProblems.filter((p) => !live.some((l) => l.field === p.field))]
  }, [submitted, result, saveProblems])
  const errorFor = (field: string) => problems.find((p) => p.field === field || p.field.startsWith(`${field}.`))?.message
  const exactError = (field: string) => problems.find((p) => p.field === field)?.message

  function change(patch: Partial<Definition>) {
    setForm((current) => ({ ...current, ...patch }))
    setTouched(true)
  }

  // A rule brings its detection method, and the sentence follows the rules until the user rewrites it.
  function changeRules(rules: SuccessRule[]) {
    setForm((current) => {
      const followsRules =
        !current.success_condition.trim() || current.success_condition === conditionFrom(current.success_rules, checks)
      let methods = current.detection_methods
      for (const rule of rules) {
        const method = checks.find((c) => c.check === rule.check)?.method
        if (method) methods = withMethod(methods, method)
      }
      return {
        ...current,
        success_rules: rules,
        detection_methods: methods,
        success_condition: followsRules ? conditionFrom(rules, checks) : current.success_condition,
      }
    })
    setTouched(true)
  }

  function showField(field: string) {
    const [top, index] = field.split(".")
    const id =
      mode === "file" && top !== "reason" ? "file" : top === "success_rules" && index ? `rule-${index}-check` : top
    const element = document.getElementById(id)
    const target = element?.matches("input, textarea, button")
      ? element
      : element?.querySelector<HTMLElement>("input, textarea, button:not([tabindex='-1'])")
    target?.scrollIntoView({ block: "center" })
    target?.focus({ preventScroll: true })
  }

  async function switchMode(next: Mode) {
    if (next === mode || switching) return
    setSwitching(true)
    try {
      if (next === "file") {
        const converted = await checkDefinition({ definition: { ...form, atlas: atlasList(atlasText) } })
        setFileText(converted.file)
        setFileError(null)
        setMode("file")
      } else {
        const converted = await checkDefinition({ file: fileText })
        const problem = converted.errors.find((e) => e.field === "file")
        if (problem) {
          setFileError(problem.message) // stays in the file view, where the problem is
          return
        }
        fill(toDefinition(converted.definition))
        setMode("form")
      }
    } catch {
      setFormError("The definition could not be converted. Try again.")
    } finally {
      setSwitching(false)
    }
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = "" // the same file can be chosen again
    if (!file) return
    setTouched(true)
    setMode("file")
    if (file.size > 20_000) {
      setFileError("The file is too long: at most 20,000 characters.")
      return
    }
    setFileText(await file.text())
    setFileError(null)
    toast.success(`${file.name} loaded`, { description: "Check the validation, then save." })
  }

  async function pick(chosen: string) {
    setPicking(false)
    try {
      fill(copyOf(await getTest(chosen)))
      setMode("form")
      setTouched(true)
      toast.success(`Filled with a copy of ${chosen}`, { description: "Adapt it, then save it as your own test." })
    } catch {
      toast.error("The test could not be loaded. Try again.")
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSubmitted(true)
    setFormError(null)
    const reasonProblem: Problem[] =
      editing && reason.trim().length < 3 ? [{ field: "reason", message: "Describe the reason for the change." }] : []
    setSaveProblems(reasonProblem)
    if (reasonProblem.length) {
      focusFirst([...(result?.errors ?? []), ...reasonProblem])
      return
    }
    setBusy(true)
    try {
      const saved = code ? await saveVersion(code, source, reason.trim()) : await createCustomTest(source)
      leaving.current = true
      toast.success(editing ? `Version ${saved.version} of ${saved.code} saved` : `${saved.code} saved as version 1`, {
        description: editing ? "Test suites use it from their next campaign run." : `Visible only to ${organization}.`,
      })
      router.push(`/test-library/${saved.code}`)
    } catch (error) {
      setBusy(false)
      if (!(error instanceof ApiError)) {
        setFormError("Something went wrong. Try again.")
        return
      }
      const details = error.details ?? []
      setSaveProblems(details)
      setFormError(
        error.code === "validation_error"
          ? "Some fields need attention. Each problem is shown next to its field."
          : error.message, // a broken content rule names the rule (UC-4.2, 5b)
      )
      focusFirst(details)
    }
  }

  function focusFirst(found: Problem[]) {
    const fields = found.map((p) => p.field)
    const first = FORM_ORDER.find((name) => fields.some((f) => f === name || f.startsWith(`${name}.`)))
    const field = fields.find((f) => f === first || f.startsWith(`${first}.`))
    if (field) requestAnimationFrame(() => showField(field))
  }

  if (canManage === false) {
    return (
      <EmptyState
        title="Only Security Analysts create and change custom tests"
        description="You can browse the Test Library. Ask a Security Analyst of your organization to add the test."
        action={
          <Button asChild variant="outline" className="h-9">
            <Link href="/test-library">Back to the Test Library</Link>
          </Button>
        }
      />
    )
  }
  if (loadError === "not_found") {
    return (
      <EmptyState
        title="Test definition not found"
        description="It doesn't exist, or it belongs to another organization."
        action={
          <Button asChild variant="outline" className="h-9">
            <Link href="/test-library">Back to the Test Library</Link>
          </Button>
        }
      />
    )
  }
  if (loadError) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>The editor could not be loaded. Reload the page to try again.</AlertDescription>
      </Alert>
    )
  }
  if (original && (original.origin === "built_in" || original.retired)) {
    // UC-4.3, 1a: built-in tests are read-only; a retired test can't be changed either.
    return (
      <EmptyState
        title={original.retired ? "This test is retired" : "Built-in tests are read-only"}
        description={`To adapt ${original.code}, duplicate it as a new custom test of ${organization}.`}
        action={
          <Button asChild className="h-9 hover:bg-primary-hover">
            <Link href={`/test-library/new?from=${encodeURIComponent(original.code)}`}>Duplicate as custom test</Link>
          </Button>
        }
      />
    )
  }
  if (!vocab || !ready || canManage === undefined) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading the editor">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  const chosenTemplate = vocab.templates.find((t) => t.name === form.attempt_template)
  const groups = Array.from(new Set(vocab.templates.map((t) => t.category))).sort((a, b) =>
    a === form.category ? -1 : b === form.category ? 1 : a.localeCompare(b),
  )
  const fileProblem = fileError ?? errorFor("file")

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">{editing ? "Edit custom test" : "New Custom Test"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {editing && original ? (
            <>
              <span className="font-mono">{original.code}</span> · version {original.version} is current; saving
              creates version {original.version + 1}.
            </>
          ) : (
            `Saved as version 1 and visible only to ${organization}.`
          )}
        </p>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span id="mode-label" className="sr-only">
          Edit the test as
        </span>
        <SegmentedControl<Mode>
          value={mode}
          onChange={switchMode}
          labelledBy="mode-label"
          disabled={switching}
          options={[
            { value: "form", label: "Form" },
            { value: "file", label: "Definition file (YAML)" },
          ]}
        />
        {!editing && (
          <Button type="button" variant="link" className="h-9 px-1" onClick={() => setPicking(true)}>
            <Library aria-hidden="true" />
            Start from a built-in test
          </Button>
        )}
        <Button type="button" variant="outline" className="h-9" onClick={() => fileInput.current?.click()}>
          <FileUp aria-hidden="true" />
          Upload definition file
        </Button>
        <input ref={fileInput} type="file" accept=".yaml,.yml,.json" hidden onChange={upload} />
      </div>

      {formError && (
        <Alert variant="destructive" role="alert" className="mb-5">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <form id="custom-test" onSubmit={save} noValidate className="min-w-0 space-y-6">
          {mode === "file" ? (
            <Section
              id="file-heading"
              title="Definition file"
              description="The same fields as the form, in YAML or JSON. Leave out code: Sentra gives the test its ID."
            >
              <div className="space-y-1.5">
                <Label htmlFor="file">Definition</Label>
                <TemplateEditor
                  id="file"
                  value={fileText}
                  onChange={(value) => {
                    setFileText(value)
                    setFileError(null)
                    setTouched(true)
                  }}
                  invalid={!!fileProblem}
                  describedBy={fileProblem ? "file-error" : undefined}
                />
                {fileProblem && (
                  <p id="file-error" className="text-xs text-destructive">
                    {fileProblem}
                  </p>
                )}
                {submitted && problems.some((p) => p.field !== "file" && p.field !== "reason") && (
                  <ul className="space-y-0.5 text-xs text-destructive">
                    {problems
                      .filter((p) => p.field !== "file" && p.field !== "reason")
                      .map((p) => (
                        <li key={p.field + p.message}>
                          <span className="font-mono">{p.field}</span>: {p.message}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </Section>
          ) : (
            <>
              <Section id="about-heading" title="About the test">
                <FormField id="name" label="Name" error={errorFor("name")}>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => change({ name: e.target.value })}
                    maxLength={120}
                    autoComplete="off"
                    className="h-9"
                    aria-invalid={!!errorFor("name") || undefined}
                    aria-describedby={describedBy(errorFor("name") && "name-error")}
                  />
                </FormField>
                <FormField id="category" label="Category (OWASP Top 10 for LLM Applications)" error={errorFor("category")}>
                  <Select value={form.category} onValueChange={(category) => change({ category })}>
                    <SelectTrigger
                      id="category"
                      className="h-9 w-full sm:w-96"
                      aria-invalid={!!errorFor("category") || undefined}
                      aria-describedby={describedBy(errorFor("category") && "category-error")}
                    >
                      <SelectValue placeholder="Choose a category" />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField id="objective" label="Objective" error={errorFor("objective")}>
                  <Textarea
                    id="objective"
                    value={form.objective}
                    onChange={(e) => change({ objective: e.target.value })}
                    maxLength={600}
                    rows={3}
                    placeholder="Checks whether …"
                    aria-invalid={!!errorFor("objective") || undefined}
                    aria-describedby={describedBy(errorFor("objective") && "objective-error")}
                  />
                </FormField>
                <FormField id="prerequisites" label="Prerequisites" error={errorFor("prerequisites")}>
                  <Textarea
                    id="prerequisites"
                    value={form.prerequisites}
                    onChange={(e) => change({ prerequisites: e.target.value })}
                    maxLength={600}
                    rows={2}
                    placeholder="The target …"
                    aria-invalid={!!errorFor("prerequisites") || undefined}
                    aria-describedby={describedBy(errorFor("prerequisites") && "prerequisites-error")}
                  />
                </FormField>
                <fieldset id="target_types" className="space-y-2" aria-describedby={describedBy(errorFor("target_types") && "target_types-error")}>
                  <legend className="text-sm font-medium">Applicable target types</legend>
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    {Object.entries(TARGET_TYPE_LABEL).map(([type, label]) => (
                      <div key={type} className="flex items-center gap-2">
                        <Checkbox
                          id={`type-${type}`}
                          checked={form.target_types.includes(type)}
                          onCheckedChange={(on) =>
                            change({
                              target_types: on
                                ? Object.keys(TARGET_TYPE_LABEL).filter((t) => t === type || form.target_types.includes(t))
                                : form.target_types.filter((t) => t !== type),
                            })
                          }
                        />
                        <label htmlFor={`type-${type}`} className="py-1 text-sm">
                          {label}
                        </label>
                      </div>
                    ))}
                  </div>
                  {errorFor("target_types") && (
                    <p id="target_types-error" className="text-xs text-destructive">
                      {errorFor("target_types")}
                    </p>
                  )}
                </fieldset>
              </Section>

              <Section
                id="attempts-heading"
                title="How attempts are built"
                description="Sentra builds the attempts at run time from a safe template, with synthetic content and canary tokens. A test never contains attack text."
              >
                <FormField id="attempt_template" label="Safe template" error={errorFor("attempt_template")}>
                  <Select value={form.attempt_template} onValueChange={(attempt_template) => change({ attempt_template })}>
                    <SelectTrigger
                      id="attempt_template"
                      className="h-9 w-full sm:w-96"
                      aria-invalid={!!errorFor("attempt_template") || undefined}
                      aria-describedby={describedBy(chosenTemplate && "attempt_template-help", errorFor("attempt_template") && "attempt_template-error")}
                    >
                      <SelectValue placeholder="Choose a template" />
                    </SelectTrigger>
                    <SelectContent>
                      {groups.map((category) => (
                        <SelectGroup key={category}>
                          <SelectLabel>
                            {category} {vocab.templates.find((t) => t.category === category)?.category_name}
                          </SelectLabel>
                          {vocab.templates
                            .filter((t) => t.category === category)
                            .map((t) => (
                              <SelectItem key={t.name} value={t.name}>
                                {t.label}
                              </SelectItem>
                            ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                  {chosenTemplate && (
                    <p id="attempt_template-help" className="text-xs text-muted-foreground">
                      Used by the built-in test {chosenTemplate.used_by_code} {chosenTemplate.used_by_name}. Works with{" "}
                      {chosenTemplate.target_types.map((t) => TARGET_TYPE_LABEL[t]).join(", ")}.
                    </p>
                  )}
                </FormField>
              </Section>

              <Section
                id="success-heading"
                title="Success condition"
                description="What shows that the test succeeded, and the detection methods that check it."
              >
                <div id="success_rules" className="space-y-2">
                  <RuleBuilder rules={form.success_rules} checks={checks} errorFor={errorFor} onChange={changeRules} />
                  {exactError("success_rules") && (
                    <p className="text-xs text-destructive" role="status">
                      {exactError("success_rules")}
                    </p>
                  )}
                </div>
                <FormField id="success_condition" label="Success condition in words" error={errorFor("success_condition")}>
                  <Textarea
                    id="success_condition"
                    value={form.success_condition}
                    onChange={(e) => change({ success_condition: e.target.value })}
                    maxLength={600}
                    rows={2}
                    aria-invalid={!!errorFor("success_condition") || undefined}
                    aria-describedby={describedBy("success_condition-help", errorFor("success_condition") && "success_condition-error")}
                  />
                  <p id="success_condition-help" className="text-xs text-muted-foreground">
                    Written from the rules; you can change the wording. Reports and the LLM judge use it.
                  </p>
                </FormField>
                <DetectionPicker
                  value={form.detection_methods}
                  onChange={(detection_methods) => change({ detection_methods })}
                  error={errorFor("detection_methods")}
                />
              </Section>

              <Section id="impact-heading" title="Severity and mitigation">
                <FormField id="severity" label="Severity" error={errorFor("severity")}>
                  <Select value={form.severity} onValueChange={(severity) => change({ severity })}>
                    <SelectTrigger
                      id="severity"
                      className="h-9 w-full sm:w-56"
                      aria-invalid={!!errorFor("severity") || undefined}
                      aria-describedby={describedBy(errorFor("severity") && "severity-error")}
                    >
                      <SelectValue placeholder="Choose the severity" />
                    </SelectTrigger>
                    <SelectContent>
                      {SEVERITIES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {SEVERITY_LABEL[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField id="recommended_mitigation" label="Recommended mitigation" error={errorFor("recommended_mitigation")}>
                  <Textarea
                    id="recommended_mitigation"
                    value={form.recommended_mitigation}
                    onChange={(e) => change({ recommended_mitigation: e.target.value })}
                    maxLength={1000}
                    rows={3}
                    aria-invalid={!!errorFor("recommended_mitigation") || undefined}
                    aria-describedby={describedBy(errorFor("recommended_mitigation") && "recommended_mitigation-error")}
                  />
                </FormField>
              </Section>

              <Section id="mapping-heading" title="Framework mapping">
                <div className="space-y-1">
                  <p className="text-sm font-medium">OWASP Top 10 for LLM Applications</p>
                  <p className="text-sm text-text-secondary">
                    {CATEGORIES.find((c) => c.value === form.category)?.label ?? "Follows the category above."}{" "}
                    <span className="text-muted-foreground">(required: the category above)</span>
                  </p>
                </div>
                <FormField id="atlas" label="MITRE ATLAS techniques (optional)" error={errorFor("atlas")}>
                  <Input
                    id="atlas"
                    value={atlasText}
                    onChange={(e) => {
                      setAtlasText(e.target.value)
                      setTouched(true)
                    }}
                    placeholder="AML.T0053"
                    autoComplete="off"
                    className="h-9 font-mono text-[13px] sm:w-96"
                    aria-invalid={!!errorFor("atlas") || undefined}
                    aria-describedby={describedBy("atlas-help", errorFor("atlas") && "atlas-error")}
                  />
                  <p id="atlas-help" className="text-xs text-muted-foreground">
                    Technique IDs, separated by commas.
                  </p>
                </FormField>
              </Section>
            </>
          )}

          {editing && original && (
            <Section id="reason-heading" title="Reason for the change">
              <FormField id="reason" label="Reason" error={errorFor("reason")}>
                <Textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value)
                    setTouched(true)
                  }}
                  maxLength={200}
                  rows={2}
                  placeholder="Added rule matching for the refund reference"
                  aria-invalid={!!errorFor("reason") || undefined}
                  aria-describedby={describedBy("reason-help", errorFor("reason") && "reason-error")}
                />
                <p id="reason-help" className="text-xs text-muted-foreground">
                  Shown with version {original.version + 1} in the version history.
                </p>
              </FormField>
            </Section>
          )}
        </form>

        <ValidationPanel
          result={result}
          checking={checking}
          pendingRules={mode === "form" && !form.attempt_template ? ["synthetic_data"] : []}
          organization={organization}
          onShowField={showField}
        />
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex justify-end gap-2 border-t bg-card/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        <Button type="button" variant="outline" className="h-9" onClick={() => (touched ? setConfirmLeave(true) : router.push(backTo))}>
          Cancel
        </Button>
        <Button type="submit" form="custom-test" className="h-9 hover:bg-primary-hover" disabled={busy || switching}>
          {busy ? "Saving…" : "Validate and save"}
        </Button>
      </div>

      <BuiltInPicker open={picking} onOpenChange={setPicking} onPick={pick} />
      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editing ? "Discard your changes?" : "Discard this test?"}</DialogTitle>
            <DialogDescription>
              {editing ? "The test keeps its current version." : "Nothing has been saved yet."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="h-9">
                Keep editing
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              className="h-9"
              onClick={() => {
                leaving.current = true
                router.push(backTo)
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** UC-4.2, 1a: a built-in test's definition as the start of a new custom test. */
function copyOf(test: TestDetail): Definition {
  return { ...toDefinition(test), name: `Copy of ${test.name}`.slice(0, 120) }
}
