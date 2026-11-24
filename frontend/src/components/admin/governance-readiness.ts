export type ItemState = "done" | "attention" | "optional" | "info"

export type GovernanceItem = {
  id: "members" | "mfa" | "sso" | "approval" | "retention" | "data" | "audit"
  title: string
  state: ItemState
  /** What is configured now, from the organization's own data */
  detail: string
  href: string
  action: string
}

export type GovernanceInput = {
  activeMembers: number
  suspendedMembers: number
  pendingInvitations: number
  expiredInvitations: number
  mfaRequired: boolean
  membersWithoutMfa: number
  scopeApproval: boolean
  securityManagers: number
  sso: { connected: boolean; emailDomain: string | null; testedAt: string | null }
  retention: { usingDefaults: boolean; changedBy: string | null; evidenceDays: number; campaignDays: number; reportDays: number; lastRunFailures: number; lastRunPostponed: number } | null
  data: { localOnly: boolean; externalTasks: number } | null
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * The organization's setup tasks, each with its status read from real configuration. Nothing here
 * is a requirement the product does not have: single sign-on is "optional" until it is configured
 * and never "to do", and a saved connection is reported as saved and tested, not as proven to work
 * (a login through the provider is the only proof and Sentra records none). The retention and data
 * lines state the settings and do not claim certification or compliance.
 */
export function governanceChecklist(i: GovernanceInput): GovernanceItem[] {
  const items: GovernanceItem[] = []
  items.push({
    id: "members",
    title: "Members and invitations",
    state: i.expiredInvitations > 0 ? "attention" : i.activeMembers > 1 ? "done" : "attention",
    detail:
      `${plural(i.activeMembers, "active member", "active members")}` +
      `${i.suspendedMembers ? `, ${i.suspendedMembers} suspended` : ""}` +
      `${i.pendingInvitations ? `, ${plural(i.pendingInvitations, "invitation", "invitations")} waiting` : ""}` +
      `${i.expiredInvitations ? `, ${plural(i.expiredInvitations, "invitation has", "invitations have")} expired and needs sending again` : ""}` +
      `${i.activeMembers <= 1 && !i.pendingInvitations ? ". Nobody else can log in yet." : "."}`,
    href: "/admin/members",
    action: "Open members",
  })
  items.push({
    id: "mfa",
    title: "Two-step verification",
    state: i.mfaRequired && i.membersWithoutMfa === 0 ? "done" : "attention",
    detail: i.mfaRequired
      ? i.membersWithoutMfa
        ? `Required for all members. ${plural(i.membersWithoutMfa, "member has", "members have")} not set it up yet and will be asked at the next login.`
        : "Required for all members, and every member has set it up."
      : `Not required. ${plural(i.membersWithoutMfa, "member has", "members have")} not set it up.`,
    href: "/admin/security",
    action: "Open security",
  })
  items.push({
    id: "sso",
    title: "Single sign-on",
    state: i.sso.connected ? "info" : "optional",
    detail: i.sso.connected
      ? `Saved for @${i.sso.emailDomain}. ${i.sso.testedAt ? "The connection test passed when it was saved." : "The connection was not tested."} Sentra records no login through the provider, so a first login is the only proof it works end to end.`
      : "Optional. Members log in with their Sentra password (and two-step verification where required) until you connect an identity provider.",
    href: "/admin/security",
    action: i.sso.connected ? "Review single sign-on" : "Connect a provider",
  })
  items.push({
    id: "approval",
    title: "Campaign scope approval",
    state: "info",
    detail: i.scopeApproval
      ? `On: a campaign waits for a Security Manager's decision. ${i.securityManagers === 0 ? "Nobody has the Security Manager role." : `${plural(i.securityManagers, "member can", "members can")} decide.`}`
      : "Off: campaigns run as soon as a Security Analyst launches them.",
    href: "/admin/security",
    action: "Open security",
  })
  if (i.retention) {
    const r = i.retention
    const trouble = r.lastRunFailures > 0 || r.lastRunPostponed > 0
    items.push({
      id: "retention",
      title: "Data retention",
      state: trouble ? "attention" : r.usingDefaults ? "optional" : "done",
      detail:
        `${r.usingDefaults ? "The platform's default periods apply" : `Periods set${r.changedBy ? ` by ${r.changedBy}` : ""}`}: evidence ${r.evidenceDays} days, campaign data ${r.campaignDays} days, reports ${r.reportDays} days.` +
        `${trouble ? ` The last clean-up had ${plural(r.lastRunFailures, "failure", "failures")} and postponed ${r.lastRunPostponed}.` : ""}`,
      href: "/admin/retention",
      action: "Open retention",
    })
  }
  if (i.data) {
    items.push({
      id: "data",
      title: "Data and AI",
      state: "info",
      detail: i.data.localOnly
        ? "Only local models are used; no task sends this organization's data to an external provider."
        : `${plural(i.data.externalTasks, "task sends", "tasks send")} data to an external model provider, after masking.`,
      href: "/admin/data-and-ai",
      action: "Open data and AI",
    })
  }
  items.push({
    id: "audit",
    title: "Audit log",
    state: "info",
    detail: "Every change on these pages is recorded with who made it.",
    href: "/audit-log",
    action: "Open the audit log",
  })
  return items
}

/** The items that need a person's attention, first: a returning administrator sees what is open at once. */
export function needsAttention(items: GovernanceItem[]): GovernanceItem[] {
  return items.filter((item) => item.state === "attention")
}
