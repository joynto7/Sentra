import type { Role } from "@/config/navigation"

/**
 * The text of the Help panel, per page: what the page is, what to do on it and who can do what. The
 * roles follow the permission table of the backend (FR-1.6, M1). Every member may read their
 * organization's data, so only what changes something names a role.
 *
 * A page that changes what it does should change its entry here too. No attack text, and the words of
 * the UI plan's shared brief.
 */
export type OrganizationRole = Exclude<Role, "platform_admin">

export type HelpTopic = {
  title: string
  what: string
  steps: string[]
  who: { roles: OrganizationRole[] | "everyone" | "platform"; can: string }[]
}

const ANALYST: OrganizationRole = "security_analyst"
const DEVELOPER: OrganizationRole = "target_owner"
const MANAGER: OrganizationRole = "security_manager"
const ADMIN: OrganizationRole = "org_admin"

export const ROLE_NAMES: Record<OrganizationRole, string> = {
  security_analyst: "Security Analyst",
  target_owner: "AI Application Developer",
  security_manager: "Security Manager",
  org_admin: "Organization Administrator",
}

const EVERYONE_READS = { roles: "everyone", can: "Read everything on this page." } as const

/** The first pattern that matches the address wins, so the more specific ones come first. */
const TOPICS: [RegExp, HelpTopic][] = [
  [
    /^\/dashboard/,
    {
      title: "Risk Dashboard",
      what: "The risk of all your targets at a glance, and how it has developed.",
      steps: [
        "Start with Target risk: the riskiest target comes first, with the date of its last campaign run.",
        "Use the trends to see whether findings open faster than they close.",
        "Open a target, a category or a finding to see what is behind a number.",
      ],
      who: [EVERYONE_READS, { roles: [ANALYST, MANAGER], can: "Generate the executive report." }],
    },
  ],
  [
    /^\/attack-paths/,
    {
      title: "Attack Paths",
      what: "How single weaknesses of one target combine into a larger impact, along the components its Target Profile records.",
      steps: [
        "Choose a target. Paths appear once its profile is mapped and it has open findings.",
        "Read a path from where a request enters to what it can reach, in the graph or the list.",
        "Open a finding on the path to see its evidence.",
        "Dismiss a path that can't happen in your setup, and say why.",
      ],
      who: [EVERYONE_READS, { roles: [ANALYST], can: "Dismiss a path, or take a dismissal back." }],
    },
  ],
  [
    /^\/framework-coverage/,
    {
      title: "Framework Coverage",
      what: "Which OWASP and MITRE ATLAS categories have really been tested on each target. A plan doesn't count: only an attempt the target answered, in a run that ended.",
      steps: [
        "Look for Gap: never tested, or not tested since the target changed.",
        "Choose one target to see it alone, or switch between OWASP and MITRE ATLAS.",
        "Create a campaign that covers a gap.",
      ],
      who: [EVERYONE_READS, { roles: [ANALYST], can: "Create the campaign that closes a gap." }],
    },
  ],
  [
    /^\/getting-started/,
    {
      title: "Getting Started",
      what: "The steps from a new organization to its first results, in about 15 minutes.",
      steps: [
        "Follow the steps in order. Each says what is done and links to the page for the next one.",
        "Without an application of your own, deploy a lab target and test that.",
      ],
      who: [
        { roles: [ADMIN], can: "Create the organization and invite the team." },
        { roles: [DEVELOPER], can: "Register a target and verify its ownership." },
        { roles: [ANALYST], can: "Create and launch the first campaign." },
      ],
    },
  ],
  [
    /^\/targets\/new/,
    {
      title: "Register Target",
      what: "Adds an AI application that your organization owns or may test. No campaign can run against it until its ownership is verified.",
      steps: [
        "Enter its details and the address of its endpoint.",
        "Say how it takes a message and where its reply is.",
        "Add credentials if it needs them. They are stored encrypted and never shown again.",
        "Test the connection, then prove that you own it.",
      ],
      who: [{ roles: [DEVELOPER], can: "Register targets." }],
    },
  ],
  [
    /^\/targets\/[^/]+\/verify/,
    {
      title: "Verify ownership",
      what: "Proves that your organization controls this application. Sentra tests only what is verified.",
      steps: [
        "Publish the token the way the page shows: as a DNS record, or as a file on the application.",
        "Check again. Sentra looks for the token and records the result.",
      ],
      who: [{ roles: [DEVELOPER], can: "Verify target ownership." }],
    },
  ],
  [
    /^\/targets\/[^/]+\/profile/,
    {
      title: "Target Profile",
      what: "What the application consists of: how the model behaves, its knowledge sources and its tools. Threat models and attack paths are built on it.",
      steps: [
        "Map the profile: Sentra sends a few harmless requests and records what it learns.",
        "Correct or complete what it found.",
        "Save your review, so that the threat model can rely on it.",
      ],
      who: [EVERYONE_READS, { roles: [ANALYST, DEVELOPER], can: "Map and review the profile." }],
    },
  ],
  [
    /^\/targets\/[^/]+\/edit/,
    {
      title: "Edit target",
      what: "The target's details, endpoint, connection format and credentials.",
      steps: [
        "Change what has changed. Earlier test results may no longer hold after that, and Framework Coverage says so.",
        "Credentials are masked. To change one, enter a new one.",
      ],
      who: [EVERYONE_READS, { roles: [DEVELOPER], can: "Change the target or archive it." }],
    },
  ],
  [
    /^\/targets\/[^/]+\/history/,
    {
      title: "Target history",
      what: "What has happened to this target, and how its risk developed after each campaign run.",
      steps: ["Read the chart as a table with View as table.", "Open a campaign run from the list to see it."],
      who: [EVERYONE_READS],
    },
  ],
  [
    /^\/targets\/[^/]+\/shield/,
    {
      title: "Sentra Shield of this target",
      what: "The gateway in front of this application, and the Shield Policy it enforces.",
      steps: [
        "Check that the gateway reports in.",
        "Deploy approved fixes that aren't in the policy yet.",
        "Roll back a version that causes problems. The rollback is recorded with its reason.",
      ],
      who: [
        EVERYONE_READS,
        { roles: [DEVELOPER], can: "Connect a gateway and deploy fixes." },
        { roles: [DEVELOPER, ANALYST], can: "Roll back a Shield Policy." },
      ],
    },
  ],
  [
    /^\/targets\/[^/]+/,
    {
      title: "Target",
      what: "Everything about one target: risk, ownership, Sentra Shield, recent runs, connection, profile and threat model.",
      steps: [
        "Check that ownership is verified. Until then nothing can be tested.",
        "Use the tabs for its profile, threat model, campaigns, findings, Sentra Shield and history.",
      ],
      who: [
        EVERYONE_READS,
        { roles: [DEVELOPER], can: "Change the target." },
        { roles: [ANALYST, DEVELOPER], can: "Test its connection." },
        { roles: [ANALYST], can: "Create a campaign for it." },
      ],
    },
  ],
  [
    /^\/targets/,
    {
      title: "Targets",
      what: "The AI applications your organization is allowed to test, with their ownership and risk.",
      steps: [
        "Search or filter the list, and open a target.",
        "Look at Ownership: an unverified target can't be tested and has no risk score.",
        "Archived targets are kept with their history, on their own tab.",
      ],
      who: [EVERYONE_READS, { roles: [DEVELOPER], can: "Register targets." }],
    },
  ],
  [
    /^\/threat-models\/[^/]+\/recommendations/,
    {
      title: "Recommended test suites",
      what: "The test suites that cover this threat model, the highest risk first.",
      steps: [
        "Sentra ticks the smallest set that covers every threat it can test. Change it if you need to.",
        "Create a campaign from the ticked suites.",
      ],
      who: [EVERYONE_READS, { roles: [ANALYST], can: "Create a campaign from them." }],
    },
  ],
  [
    /^\/threat-models\/[^/]+\/versions/,
    {
      title: "Threat model versions",
      what: "Every change is a new version, and stored versions never change, so a campaign always says what it was based on.",
      steps: ["Compare two versions to see what changed.", "See which campaign runs used a version."],
      who: [EVERYONE_READS],
    },
  ],
  [
    /^\/threat-models\/[^/]+/,
    {
      title: "Threat model",
      what: "What could go wrong in one target, with where each threat comes from. An AI-generated draft counts only after a person has approved it.",
      steps: [
        "Go through the threats: correct them, remove them or add your own.",
        "Approve the version.",
        "Open Recommended suites to start a campaign from it.",
      ],
      who: [EVERYONE_READS, { roles: [ANALYST], can: "Review and approve threat models." }],
    },
  ],
  [
    /^\/threat-models/,
    {
      title: "Threat Models",
      what: "What could go wrong in each target, mapped to OWASP and MITRE ATLAS.",
      steps: [
        "Start with the drafts that await review; they come first.",
        "Open a target's threat model. A target's profile has to be mapped before one can be generated.",
      ],
      who: [EVERYONE_READS, { roles: [ANALYST], can: "Review and approve threat models." }],
    },
  ],
  [
    /^\/test-library\/suites\/new/,
    {
      title: "New test suite",
      what: "Your own group of tests, to use in campaigns. Only your organization sees it.",
      steps: ["Name it and say what it is for.", "Add tests from the library.", "Save it as version 1."],
      who: [{ roles: [ANALYST], can: "Build test suites." }],
    },
  ],
  [
    /^\/test-library\/new/,
    {
      title: "New custom test",
      what: "Your own test, as a form or a definition file. Only your organization sees it.",
      steps: [
        "Start from a built-in test, or from nothing.",
        "Describe the objective, how attempts are built and what counts as success.",
        "Use placeholders for test content, never real attack text. Sentra validates the test when you save it.",
      ],
      who: [{ roles: [ANALYST], can: "Create custom tests." }],
    },
  ],
  [
    /^\/test-library\/suites\/.+/,
    {
      title: "Test suite",
      what: "A named group of tests, and the campaigns that use it.",
      steps: ["Read what it covers and how many attempts it means per run.", "Duplicate a built-in suite to change it."],
      who: [EVERYONE_READS, { roles: [ANALYST], can: "Build test suites." }],
    },
  ],
  [
    /^\/test-library\/.+/,
    {
      title: "Test definition",
      what: "One security test: its objective, the target types it applies to, its success condition and how to fix what it finds.",
      steps: ["Read the success condition: that is what makes a finding.", "Duplicate a built-in test to change it, or add it to a suite."],
      who: [EVERYONE_READS, { roles: [ANALYST], can: "Create custom tests and suites." }],
    },
  ],
  [
    /^\/test-library/,
    {
      title: "Test Library",
      what: "Declarative security tests and test suites, mapped to OWASP and MITRE ATLAS.",
      steps: [
        "Filter by OWASP category, or open the Test suites tab.",
        "Open a test to read its objective and success condition.",
        "Built-in tests are read-only. Duplicate one to make it your own.",
      ],
      who: [EVERYONE_READS, { roles: [ANALYST], can: "Create custom tests and suites." }],
    },
  ],
  [
    /^\/campaigns\/new/,
    {
      title: "New campaign",
      what: "What is tested, how much and how fast. Creating a campaign sends nothing to the target.",
      steps: [
        "Choose a verified target. If it has an approved threat model, its suites are ticked for you.",
        "Choose the test suites.",
        "Set the limits: the attempt budget and the request rate.",
        "Choose when it runs, then create it.",
      ],
      who: [{ roles: [ANALYST], can: "Create and launch campaigns." }],
    },
  ],
  [
    /^\/campaigns\/[^/]+\/runs\/[^/]+/,
    {
      title: "Campaign run",
      what: "One run of a campaign, live or finished: how far it is, what it found, and what it was based on.",
      steps: [
        "Follow the live events while it runs.",
        "Pause or stop it if the target suffers. No further attempt is sent after a stop.",
        "Open a finding from the list.",
      ],
      who: [
        EVERYONE_READS,
        { roles: [ANALYST], can: "Pause and resume a run." },
        { roles: [ANALYST, DEVELOPER], can: "Stop a run." },
      ],
    },
  ],
  [
    /^\/campaigns\/[^/]+\/approval/,
    {
      title: "Scope approval",
      what: "A Security Manager's decision on what a campaign may test, before it can run.",
      steps: [
        "Read the scope: target, suites, limits and threat model.",
        "Approve it, or reject it and say why. The decision is recorded permanently.",
      ],
      who: [EVERYONE_READS, { roles: [MANAGER], can: "Approve or reject a campaign's scope." }],
    },
  ],
  [
    /^\/campaigns\/[^/]+/,
    {
      title: "Campaign",
      what: "One campaign: its target, test suites, limits, schedule and runs.",
      steps: ["Launch a run when it is ready.", "Open a run from the list to see it."],
      who: [EVERYONE_READS, { roles: [ANALYST], can: "Launch and change campaigns." }],
    },
  ],
  [
    /^\/autopilot/,
    {
      title: "Autopilot",
      what: "One assessment of a verified target, from the threat model to the remediation proposals. It stops wherever a person has to decide.",
      steps: [
        "Choose a verified target and read the plan: the tests, the attempts, the time and what you still decide.",
        "Start it. It sends test traffic to the target within its safe rate, so you confirm first.",
        "When it waits for you, open the page it names, decide, and it goes on by itself.",
        "When it has finished, review the findings and approve the fixes you want.",
      ],
      who: [
        EVERYONE_READS,
        { roles: [ANALYST], can: "Start and stop an assessment." },
        { roles: [ANALYST, MANAGER], can: "Approve fixes. The autopilot never approves anything for you." },
      ],
    },
  ],
  [
    /^\/campaigns/,
    {
      title: "Campaigns",
      what: "Security assessments of your verified targets: what is tested, how much and how fast.",
      steps: [
        "The counts at the top show what is running, paused or awaiting approval.",
        "Open a campaign, or use the Campaign runs tab to see all runs.",
      ],
      who: [
        EVERYONE_READS,
        { roles: [ANALYST], can: "Create and launch campaigns." },
        { roles: [MANAGER], can: "Approve a campaign's scope." },
      ],
    },
  ],
  [
    /^\/findings\/[^/]+\/evidence/,
    {
      title: "Evidence",
      what: "The attempts that prove this finding, as they were recorded. A checksum shows that nothing changed them.",
      steps: [
        "Open an attempt: what was sent, the target's reply, its tool calls and the detection results.",
        "A target's reply is shown as plain text and is never run.",
      ],
      who: [EVERYONE_READS],
    },
  ],
  [
    /^\/findings\/[^/]+\/activity/,
    {
      title: "Finding activity",
      what: "Every decision about this finding, in order. Entries can't be changed afterwards.",
      steps: ["Read who decided what, and why.", "Add a comment for the people working on it."],
      who: [EVERYONE_READS, { roles: [ANALYST], can: "Triage and comment." }],
    },
  ],
  [
    /^\/findings\/[^/]+/,
    {
      title: "Finding",
      what: "One weakness of a target: what happened, why it matters, how to fix it and why it has this severity.",
      steps: [
        "Read why it has this severity, then check the evidence.",
        "Triage it: confirm it or mark it as a false positive, set the owner, or adjust the severity with a reason.",
        "Request a remediation to get a proposed fix.",
      ],
      who: [
        EVERYONE_READS,
        { roles: [ANALYST], can: "Triage findings." },
        { roles: [ANALYST, DEVELOPER], can: "Request a remediation." },
      ],
    },
  ],
  [
    /^\/findings/,
    {
      title: "Findings",
      what: "Weaknesses found in your targets, each with its evidence.",
      steps: [
        "Start with All open or Assigned to me. Requires confirmation lists what only the LLM judge found.",
        "Filter by target, severity, category, status, owner or campaign run.",
        "Open a finding to read it and triage it.",
      ],
      who: [EVERYONE_READS, { roles: [ANALYST], can: "Triage findings." }],
    },
  ],
  [
    /^\/remediation\/changes/,
    {
      title: "Application changes",
      what: "Fixes that must be made inside your application, because a gateway can't enforce them.",
      steps: [
        "Make the change in your application, then mark it as done.",
        "Sentra retests by itself when all fixes of a remediation are in effect.",
      ],
      who: [EVERYONE_READS, { roles: [DEVELOPER], can: "Mark a change as implemented." }],
    },
  ],
  [
    /^\/remediation\/[^/]+\/retest/,
    {
      title: "Retest",
      what: "Whether the fix worked: the same attempts before and after, and whether normal use was affected.",
      steps: [
        "Read the verdict at the top, then the comparison.",
        "If normal requests were blocked or changed, the fix may need another version.",
      ],
      who: [EVERYONE_READS],
    },
  ],
  [
    /^\/remediation\/[^/]+/,
    {
      title: "Remediation",
      what: "The proposed fix of one finding: its root cause and the fixes. Nothing takes effect until a person approves it.",
      steps: [
        "Read the root cause and each fix. AI-generated content is labelled until someone has reviewed it.",
        "Adapt it if needed, then approve it or reject it with a reason.",
        "Approved fixes go to Sentra Shield or to Application changes.",
      ],
      who: [
        EVERYONE_READS,
        { roles: [ANALYST, DEVELOPER], can: "Request and adapt a remediation." },
        { roles: [ANALYST, MANAGER], can: "Approve a remediation." },
      ],
    },
  ],
  [
    /^\/remediation/,
    {
      title: "Remediation",
      what: "Fixes for confirmed findings, from proposal to verified. Sentra proposes them, and a person reviews every one before anything changes.",
      steps: [
        "Awaiting my approval shows what waits for you.",
        "Application changes lists what has to change inside your application.",
        "A finding closes only when a retest finds that the fix worked.",
      ],
      who: [
        EVERYONE_READS,
        { roles: [ANALYST, DEVELOPER], can: "Request and adapt a remediation." },
        { roles: [ANALYST, MANAGER], can: "Approve a remediation." },
      ],
    },
  ],
  [
    /^\/shield\/connect/,
    {
      title: "Connect a gateway",
      what: "Puts Sentra Shield in front of an application, so that approved fixes can take effect. The gateway connects outbound to Sentra.",
      steps: ["Choose where it sits and follow the steps on the page.", "Check that it reports in."],
      who: [{ roles: [DEVELOPER], can: "Connect a gateway." }],
    },
  ],
  [
    /^\/shield/,
    {
      title: "Sentra Shield",
      what: "Gateways that enforce approved fixes in front of your AI applications. They keep enforcing their last Shield Policy if Sentra can't be reached.",
      steps: ["Check which gateways report in.", "Open a target to deploy fixes or roll back a policy."],
      who: [
        EVERYONE_READS,
        { roles: [DEVELOPER], can: "Connect a gateway and deploy fixes." },
        { roles: [DEVELOPER, ANALYST], can: "Roll back a Shield Policy." },
      ],
    },
  ],
  [
    /^\/reports/,
    {
      title: "Reports",
      what: "Executive and technical reports of your targets, generated by Sentra and kept with their checksum.",
      steps: [
        "Generate a report: choose its type, scope and period.",
        "Download it when it is ready. If nothing falls in the scope, it says so.",
        "Schedule a report to send a link regularly. Files are never sent by e-mail.",
      ],
      who: [EVERYONE_READS, { roles: [ANALYST, MANAGER], can: "Generate and schedule reports." }],
    },
  ],
  [
    /^\/integrations\/api-keys/,
    {
      title: "API keys",
      what: "Keys that let your own systems read Sentra's data, limited to what each key is for.",
      steps: ["Create a key and copy it: it is shown only once.", "Revoke a key that is no longer used."],
      who: [{ roles: [ADMIN], can: "Manage API keys." }],
    },
  ],
  [
    /^\/integrations\/webhooks/,
    {
      title: "Webhooks",
      what: "Sends Sentra's events to your own systems.",
      steps: ["Add the address and choose the events.", "Check the deliveries to see whether they arrive."],
      who: [{ roles: [ADMIN], can: "Manage webhooks." }],
    },
  ],
  [
    /^\/integrations/,
    {
      title: "Security gates",
      what: "An automatic check every release of an application has to pass before it goes out.",
      steps: [
        "Create a gate for a target and a campaign, with the policy it enforces.",
        "Add it to your pipeline with the Sentra CLI.",
        "Make it active when it is ready.",
      ],
      who: [EVERYONE_READS, { roles: [ANALYST], can: "Configure security gates." }],
    },
  ],
  [
    /^\/audit-log/,
    {
      title: "Audit Log",
      what: "Who did what in your organization, and when. Entries can't be changed or deleted.",
      steps: ["Filter by person, action or time.", "Export the entries you need."],
      who: [{ roles: [ADMIN], can: "Review the audit log." }],
    },
  ],
  [
    /^\/admin\/security/,
    {
      title: "Organization Security",
      what: "How members of your organization log in: two-step verification and single sign-on.",
      steps: ["Change a setting. You confirm with your password.", "Tell your members before you require something new."],
      who: [{ roles: [ADMIN], can: "Change organization security." }],
    },
  ],
  [
    /^\/admin\/data-and-ai/,
    {
      title: "Data and AI",
      what: "Which models process your organization's data, and what may be shared with them.",
      steps: ["Read which tasks use which model.", "Change what is allowed."],
      who: [{ roles: [ADMIN], can: "Set data sharing." }],
    },
  ],
  [
    /^\/admin\/retention/,
    {
      title: "Data Retention",
      what: "How long Sentra keeps your organization's data before deleting it.",
      steps: ["Set the period for each kind of data.", "Check what the next clean-up will delete."],
      who: [{ roles: [ADMIN], can: "Set the retention periods." }],
    },
  ],
  [
    /^\/admin/,
    {
      title: "Members",
      what: "The people in your organization, and their roles.",
      steps: ["Invite someone and choose a role.", "Change a role or remove a member. You confirm with your password."],
      who: [{ roles: [ADMIN], can: "Invite, remove and change members." }],
    },
  ],
  [
    /^\/lab\/benchmarks/,
    {
      title: "Benchmark run",
      what: "Measures how well Sentra finds the known weaknesses of the lab targets, repeated so that the numbers can be trusted.",
      steps: ["Read the results per strategy.", "Label the results that need a person's decision.", "Export the results with their checksum."],
      who: [EVERYONE_READS, { roles: [ANALYST], can: "Run benchmarks." }],
    },
  ],
  [
    /^\/lab/,
    {
      title: "Security Lab",
      what: "Intentionally vulnerable lab targets in an isolated zone: synthetic data, simulated tools and no internet access.",
      steps: [
        "Deploy a lab target. It appears among your targets, ready to test.",
        "Reset one to start again from a clean state.",
        "Start a benchmark run to measure how much Sentra finds.",
      ],
      who: [EVERYONE_READS, { roles: [ANALYST], can: "Use the Security Lab and benchmarks." }],
    },
  ],
  [
    /^\/notifications/,
    {
      title: "Notifications",
      what: "Everything Sentra told you about, newest first.",
      steps: ["Open a notification to go to what it is about.", "Choose which ones you get in your profile."],
      who: [{ roles: "everyone", can: "See their own notifications." }],
    },
  ],
  [
    /^\/account\/security/,
    {
      title: "Security",
      what: "Your password, two-step verification, where you are logged in and what happened recently.",
      steps: ["Turn on two-step verification and keep the recovery codes.", "Log out a session you don't recognise."],
      who: [{ roles: "everyone", can: "Change their own security settings." }],
    },
  ],
  [
    /^\/account/,
    {
      title: "Profile",
      what: "Your personal details, as other members of your organization see them.",
      steps: ["Change your name.", "Choose which notifications you get."],
      who: [{ roles: "everyone", can: "Change their own profile." }],
    },
  ],
  [
    /^\/platform\/organizations/,
    {
      title: "Organizations",
      what: "Usage this month against each organization's limits. Organization content is never shown.",
      steps: ["Look at who reached a limit or is close to one.", "Raise or lower a limit."],
      who: [{ roles: "platform", can: "Set usage and cost limits." }],
    },
  ],
  [
    /^\/platform\/llm-providers/,
    {
      title: "LLM Providers",
      what: "The models Sentra's own agents use, through its provider-agnostic LLM layer.",
      steps: ["Add a provider. Its key is stored encrypted.", "Assign a model to each task."],
      who: [{ roles: "platform", can: "Configure LLM providers." }],
    },
  ],
  [
    /^\/platform\/health/,
    {
      title: "System Health",
      what: "Every component of Sentra, as it is right now.",
      steps: ["Check the active alerts first.", "Use Check again after you changed something."],
      who: [{ roles: "platform", can: "Monitor the system." }],
    },
  ],
  [
    /^\/platform\/audit-log/,
    {
      title: "Platform Audit Log",
      what: "Every platform-wide action, such as granted roles and account suspensions. Entries can't be changed or deleted.",
      steps: ["Filter the entries.", "Export what you need."],
      who: [{ roles: "platform", can: "Review the platform audit log." }],
    },
  ],
  [
    /^\/platform/,
    {
      title: "Accounts",
      what: "Every Sentra account, for security and support. Organization content is never shown.",
      steps: ["Search by name or e-mail.", "Suspend an account or send a password reset."],
      who: [{ roles: "platform", can: "Manage accounts." }],
    },
  ],
]

const FALLBACK: HelpTopic = {
  title: "Sentra",
  what: "Sentra finds, proves, fixes and re-verifies security weaknesses in the AI applications your organization owns or may test.",
  steps: ["Use the menu on the left, or search for a target, finding or campaign."],
  who: [],
}

export function helpFor(pathname: string): HelpTopic {
  // A target's tabs and a finding's Remediation tab show the same lists and pages as the menu items,
  // so they have the same help.
  const page = pathname
    .replace(/^\/targets\/([^/]+)\/(threat-model|campaigns|findings)$/, (_, id, tab) =>
      tab === "threat-model" ? `/threat-models/${id}` : `/${tab}`,
    )
    .replace(/^\/findings\/([^/]+)\/remediation$/, "/remediation/$1")
  return TOPICS.find(([pattern]) => pattern.test(page))?.[1] ?? FALLBACK
}
