import type { Definition } from "@/lib/test-library"

/** What a saved suite will differ by: tests added and tests removed since the current version. */
export function suiteChange(before: string[] | null, after: string[]): { added: string[]; removed: string[] } {
  if (before === null) return { added: [...after], removed: [] }
  return { added: after.filter((c) => !before.includes(c)), removed: before.filter((c) => !after.includes(c)) }
}

const LABELS: [keyof Definition, string][] = [
  ["name", "name"],
  ["category", "category"],
  ["severity", "severity"],
  ["objective", "objective"],
  ["prerequisites", "prerequisites"],
  ["target_types", "applicable target types"],
  ["success_condition", "success condition"],
  ["detection_methods", "detection methods"],
  ["success_rules", "success rules"],
  ["attempt_template", "safe template"],
  ["recommended_mitigation", "recommended mitigation"],
  ["atlas", "framework mapping"],
]

/** The fields of a definition that differ from the current version, in the words of the form. */
export function definitionChanges(before: Definition, after: Definition): string[] {
  return LABELS.filter(([key]) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map(([, label]) => label)
}

/** What saving a suite will do, in the order it happens. The suite runs its tests' current versions by code. */
export function suiteSaveImpact(i: {
  editing: boolean
  name: string
  nextVersion: number
  count: number
  retired: number
  added: string[]
  removed: string[]
  campaigns: number
}): string[] {
  const lines: string[] = []
  lines.push(
    i.editing
      ? `Saves version ${i.nextVersion}${i.name.trim() ? ` of “${i.name.trim()}”` : ""} with ${i.count} ${i.count === 1 ? "test" : "tests"}. Version ${i.nextVersion - 1} stays in the history.`
      : `Saves${i.name.trim() ? ` “${i.name.trim()}”` : " the suite"} as version 1 with ${i.count} ${i.count === 1 ? "test" : "tests"}. No campaign uses it until one chooses it.`,
  )
  if (i.editing) {
    lines.push(i.added.length || i.removed.length ? `${i.added.length ? `Added: ${i.added.join(", ")}.` : ""}${i.added.length && i.removed.length ? " " : ""}${i.removed.length ? `Removed: ${i.removed.join(", ")}.` : ""}` : "The tests are the same as in the current version.")
    lines.push(i.campaigns ? `${i.campaigns === 1 ? "1 campaign uses" : `${i.campaigns} campaigns use`} this suite and will run version ${i.nextVersion} from the next run; earlier runs keep the version they used.` : "No campaign uses this suite yet.")
  }
  lines.push("A suite names its tests by code and always runs their current versions, so a later version of a test changes what the suite runs.")
  if (i.retired) lines.push(`${i.retired} retired ${i.retired === 1 ? "test is" : "tests are"} skipped in future runs.`)
  return lines
}
