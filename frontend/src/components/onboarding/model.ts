/**
 * The first-run setup as plain data: which steps a person gets, and which first tasks they may pick.
 * What a person may pick comes from what their role may do; the server still decides every action,
 * so a choice here only decides where the person lands.
 */

export type Can = {
  manageTargets: boolean
  lab: boolean
  campaigns: boolean
  approve: boolean
  members: boolean
}

export type StepId = "goal" | "task" | "team" | "done"
export type TaskId = "register_target" | "lab" | "campaign" | "review" | "invite" | "explore"
export type Task = { id: TaskId; label: string; href: string }
export type GoalId = "own_app" | "evaluate" | "company" | "learn"

export const GOALS: { id: GoalId; label: string }[] = [
  { id: "own_app", label: "Protect my AI application" },
  { id: "evaluate", label: "Try Sentra out" },
  { id: "company", label: "Check applications for my company" },
  { id: "learn", label: "Learn AI security" },
]

export const STEP_LABEL: Record<StepId, string> = { goal: "Goal", task: "Start", team: "Team", done: "Done" }

/** The team step is only for people who may invite. */
export function stepsFor(can: Can): StepId[] {
  return can.members ? ["goal", "task", "team", "done"] : ["goal", "task", "done"]
}

export function tasksFor(can: Can): Task[] {
  const tasks: Task[] = []
  if (can.manageTargets) tasks.push({ id: "register_target", label: "Add my application", href: "/targets/new" })
  if (can.lab) tasks.push({ id: "lab", label: "Try a practice target", href: "/lab" })
  if (can.campaigns) tasks.push({ id: "campaign", label: "Plan a test", href: "/campaigns/new" })
  if (can.approve) tasks.push({ id: "review", label: "See what waits for me", href: "/campaigns" })
  if (can.members) tasks.push({ id: "invite", label: "Invite my team", href: "/admin/members" })
  return [...tasks, { id: "explore", label: "Look around first", href: "/dashboard" }]
}

/** A starting choice that follows the goal, when the role allows it. Always editable. */
export function defaultTask(goal: string | undefined, tasks: Task[]): TaskId {
  const has = (id: TaskId) => tasks.some((task) => task.id === id)
  const prefer: TaskId[] =
    goal === "own_app" ? ["register_target", "campaign", "invite"] : goal === "company" ? ["campaign", "register_target", "review"] : ["lab", "register_target", "campaign"]
  return prefer.find(has) ?? tasks[0].id
}

/** Where "Continue" leads after the setup: the chosen task if the role may still do it, else the dashboard. */
export function destination(chosen: string | undefined, tasks: Task[]): string {
  return tasks.find((task) => task.id === chosen)?.href ?? "/dashboard"
}

/** The step to open at when someone comes back: where they stopped, but never a step they do not have. */
export function resumeAt(saved: number, steps: StepId[]): number {
  return Math.min(Math.max(saved, 0), steps.length - 1)
}

export const QUESTIONS = {
  team_size: { title: "How big is your team?", choices: ["1", "2-10", "11-50", "50+"] },
  experience: { title: "How familiar is AI security to you?", choices: ["new", "some", "expert"] },
} as const
export const EXPERIENCE_LABEL: Record<string, string> = { new: "New to it", some: "Some", expert: "Expert" }
