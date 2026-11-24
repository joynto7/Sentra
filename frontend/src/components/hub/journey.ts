/**
 * The first steps of an organization, as each person has them. A pure function of facts that the
 * server has already established (what exists, what a role may do), so it can be tested alone and
 * can never complete a task because a page was opened or a tip dismissed: a step is done only
 * when its outcome exists.
 *
 * It covers the setup chain (team, target, ownership, first campaign) and what each role waits for.
 * Ongoing work (findings to triage, approvals, changes to make) is the "Needs your attention" list
 * the dashboard already has, from the API that filters it by role; nothing is repeated here.
 */
export type JourneyState = "ready" | "waiting" | "blocked" | "optional" | "done"

export type JourneyTask = {
  id: string
  title: string
  detail: string
  state: JourneyState
  /** The step belongs to this person's role (not a step they wait for from someone else) */
  own: boolean
  /** The role that has to act, when it isn't this person */
  who?: string
  href?: string
  action?: string
}

export type Can = {
  manageMembers: boolean
  manageTargets: boolean
  verifyTargets: boolean
  manageCampaigns: boolean
  generateReports: boolean
  manageOrganizationSecurity: boolean
}

export type NamedTarget = { id: string; name: string }

export type Facts = {
  can: Can
  members: number
  openInvitations: number
  targets: { total: number; unverified: NamedTarget[]; verified: NamedTarget[] }
  campaignRunFinished: boolean
  /** Campaigns that wait for a Security Manager's decision on their scope */
  awaiting: { code: string; name: string }[]
}

export const DEVELOPER = "AI Application Developer"
export const ANALYST = "Security Analyst"
export const MANAGER = "Security Manager"

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const RANK: Record<JourneyState, number> = { ready: 0, blocked: 1, waiting: 2, optional: 3, done: 4 }

export function buildJourney(f: Facts): JourneyTask[] {
  const { can, targets } = f
  const out: JourneyTask[] = []
  const add = (task: JourneyTask) => out.push(task)

  // 1. The team
  if (can.manageMembers) {
    add(
      f.members > 1
        ? {
            id: "team",
            title: "Invite your team",
            detail: `${plural(f.members, "member", "members")}${f.openInvitations ? `, ${plural(f.openInvitations, "invitation", "invitations")} not yet accepted` : ""}.`,
            state: "done",
            own: true,
          }
        : {
            id: "team",
            title: "Invite your team",
            detail: "You are the only member. Invite the people who register targets, run campaigns and approve them.",
            state: "ready",
            own: true,
            href: "/admin/members",
            action: "Invite members",
          },
    )
  }

  // 2. A target to test
  if (can.manageTargets) {
    add(
      targets.total > 0
        ? { id: "register", title: "Register a target", detail: `${plural(targets.total, "target is", "targets are")} registered.`, state: "done", own: true }
        : {
            id: "register",
            title: "Register a target",
            detail: "Add the AI application you own and want tested.",
            state: "ready",
            own: true,
            href: "/targets/new",
            action: "Register target",
          },
    )
  } else if (targets.total === 0) {
    add({
      id: "register",
      title: "A target to test",
      detail: "No target is registered yet. An AI Application Developer registers the applications that are tested.",
      state: "waiting",
      own: false,
      who: DEVELOPER,
      href: can.manageMembers ? "/admin/members" : undefined,
      action: can.manageMembers ? "Invite a developer" : undefined,
    })
  }

  // 3. Ownership
  if (can.verifyTargets) {
    if (targets.unverified.length > 0) {
      const first = targets.unverified[0]
      add({
        id: "verify",
        title: targets.unverified.length === 1 ? `Verify ownership of ${first.name}` : `Verify ownership of ${plural(targets.unverified.length, "target", "targets")}`,
        detail: "Publish the token Sentra gives you, so that it may test the application. Ownership is checked again before every run.",
        state: "ready",
        own: true,
        href: `/targets/${first.id}/verify`,
        action: "Verify ownership",
      })
    } else if (targets.total > 0) {
      add({ id: "verify", title: "Verify ownership", detail: "Every registered target is verified.", state: "done", own: true })
    } else {
      add({ id: "verify", title: "Verify ownership", detail: "Register a target first; its ownership is verified next.", state: "blocked", own: true })
    }
  } else if (targets.unverified.length > 0 && targets.verified.length === 0) {
    add({
      id: "verify",
      title: "Ownership verification",
      detail: `${plural(targets.unverified.length, "target waits", "targets wait")} for its ownership to be verified before it can be tested.`,
      state: "waiting",
      own: false,
      who: DEVELOPER,
    })
  }

  // 4. The first campaign
  if (can.manageCampaigns) {
    if (f.campaignRunFinished) {
      add({ id: "campaign", title: "Run your first campaign", detail: "A campaign run has finished.", state: "done", own: true, href: "/campaigns", action: "Open campaigns" })
    } else if (targets.verified.length === 0) {
      add({
        id: "campaign",
        title: "Run your first campaign",
        detail:
          targets.unverified.length > 0
            ? "It needs a verified target. A target is waiting for its ownership to be verified."
            : "It needs a verified target. No target is registered yet.",
        state: "blocked",
        own: true,
        who: DEVELOPER,
      })
    } else if (f.awaiting.length > 0) {
      const one = f.awaiting[0]
      add({
        id: "campaign",
        title: "Your campaign is waiting for approval",
        detail: `${one.name} (${one.code}) can run once a Security Manager has approved its scope.${f.awaiting.length > 1 ? ` ${f.awaiting.length - 1} more wait too.` : ""}`,
        state: "waiting",
        own: true,
        who: MANAGER,
        href: `/campaigns/${one.code}`,
        action: "Open the campaign",
      })
    } else {
      const target = targets.verified[0]
      add({
        id: "campaign",
        title: "Run your first campaign",
        detail: `Start with the recommended Quick Regression on ${target.name}. The builder says whether saving starts a run or asks for approval.`,
        state: "ready",
        own: true,
        href: `/campaigns/new?target=${target.id}&suite=QUICK-REGRESSION`,
        action: "Set up a campaign",
      })
    }
  } else if (!f.campaignRunFinished) {
    add({
      id: "campaign",
      title: "The first campaign",
      detail: "A Security Analyst runs the first campaign on a verified target. Campaign results appear on the dashboard once it has finished.",
      state: "waiting",
      own: false,
      who: ANALYST,
    })
  }

  // Campaigns that wait for a Security Manager, after the first run: said as a wait, never as something to approve
  if (can.manageCampaigns && f.campaignRunFinished && f.awaiting.length > 0) {
    const one = f.awaiting[0]
    add({
      id: "awaiting",
      title: f.awaiting.length === 1 ? "A campaign is waiting for approval" : `${f.awaiting.length} campaigns are waiting for approval`,
      detail: `${one.name} (${one.code})${f.awaiting.length > 1 ? " and the others" : ""} can run once a Security Manager has approved the scope.`,
      state: "waiting",
      own: true,
      who: MANAGER,
      href: `/campaigns/${one.code}`,
      action: "Open the campaign",
    })
  }

  // 5. Optional, and only when there is something real to say
  if (can.generateReports && f.campaignRunFinished) {
    add({ id: "report", title: "Generate an executive report", detail: "A summary for people who don't use Sentra.", state: "optional", own: true, href: "/reports", action: "Open reports" })
  }
  if (can.manageOrganizationSecurity) {
    add({
      id: "security",
      title: "Review organization security",
      detail: "Decide whether every member needs two-step verification and whether a campaign's scope needs a Security Manager's approval.",
      state: "optional",
      own: true,
      href: "/admin/security",
      action: "Open security",
    })
  }

  return out.map((task, index) => ({ task, index })).sort((a, b) => RANK[a.task.state] - RANK[b.task.state] || a.index - b.index).map((x) => x.task)
}

export type JourneySummary = {
  /** Own steps that are done, and all own setup steps (optional steps are not counted) */
  done: number
  total: number
  /** Steps that need this person now */
  ready: number
  /** Nothing is ready, blocked or waiting any more */
  quiet: boolean
}

export function summarize(tasks: JourneyTask[]): JourneySummary {
  const own = tasks.filter((task) => task.own && task.state !== "optional")
  return {
    done: own.filter((task) => task.state === "done").length,
    total: own.length,
    ready: tasks.filter((task) => task.state === "ready").length,
    quiet: tasks.every((task) => task.state === "done" || task.state === "optional"),
  }
}

// ---------------------------------------------------------------- the platform (a separate shell)

export type PlatformFacts = {
  health: { status: "operational" | "warning" | "alert" | "unknown"; openAlerts: number } | null
  providers: { total: number; untested: string[] } | null
  organizationsAtLimit: number | null
}

/** The Platform Administrator's first steps. Never shown in an organization, and no customer content. */
export function buildPlatformJourney(f: PlatformFacts): JourneyTask[] {
  const out: JourneyTask[] = []
  if (f.health === null) {
    out.push({ id: "health", title: "System health", detail: "The health of the services could not be read, so nothing is said about it.", state: "blocked", own: true, href: "/platform/health", action: "Open system health" })
  } else if (f.health.openAlerts > 0 || f.health.status === "warning" || f.health.status === "alert") {
    out.push({
      id: "health",
      title: f.health.openAlerts > 0 ? `${plural(f.health.openAlerts, "open alert", "open alerts")}` : "A service needs a look",
      detail: "Open the system health page for the component, since when, and what to do.",
      state: "ready",
      own: true,
      href: "/platform/health",
      action: "Open system health",
    })
  } else if (f.health.status === "unknown") {
    out.push({ id: "health", title: "System health", detail: "The status of a service is unknown. Unknown is not healthy.", state: "blocked", own: true, href: "/platform/health", action: "Open system health" })
  } else {
    out.push({ id: "health", title: "System health", detail: "Every component reports operational, now.", state: "done", own: true, href: "/platform/health", action: "Open system health" })
  }
  if (f.providers !== null) {
    if (f.providers.total === 0) {
      out.push({ id: "providers", title: "Add an LLM provider", detail: "Sentra's own agents need a provider before they can generate threat models, judge attempts or draft fixes.", state: "ready", own: true, href: "/platform/llm-providers", action: "Open LLM providers" })
    } else if (f.providers.untested.length > 0) {
      out.push({
        id: "providers",
        title: `Test ${f.providers.untested.join(", ")}`,
        detail: "A saved key is not a working connection. Run the test request to see that the provider answers.",
        state: "ready",
        own: true,
        href: "/platform/llm-providers",
        action: "Open LLM providers",
      })
    } else {
      out.push({ id: "providers", title: "LLM providers", detail: `${plural(f.providers.total, "provider is", "providers are")} configured and each has had a test request.`, state: "done", own: true, href: "/platform/llm-providers", action: "Open LLM providers" })
    }
  }
  if (f.organizationsAtLimit !== null && f.organizationsAtLimit > 0) {
    out.push({ id: "limits", title: `${plural(f.organizationsAtLimit, "organization has", "organizations have")} reached a monthly limit`, detail: "No new run starts for them until a limit is raised or the month turns.", state: "ready", own: true, href: "/platform/organizations", action: "Open organizations" })
  }
  return out.map((task, index) => ({ task, index })).sort((a, b) => RANK[a.task.state] - RANK[b.task.state] || a.index - b.index).map((x) => x.task)
}
