/**
 * What the public page says. Every statement here describes something Sentra does today and can be
 * shown in the product; nothing is a customer, a number, a certification or a promise. Keep it that
 * way: a claim goes in only with the screen or the use case behind it.
 */

export const NAV = [
  { href: "#platform", label: "Platform" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#use-cases", label: "Use cases" },
  { href: "#faq", label: "FAQ" },
] as const

/** The three jobs of the core loop, as the README names its phases: find, prove, fix. */
export const PILLARS = [
  {
    id: "find",
    name: "Find",
    text: "Sentra learns what your application is made of and tests it, inside limits you set.",
    steps: [
      "Register the application and prove you own it",
      "Map its tools, knowledge sources and prompts",
      "Run versioned security tests within your limits",
    ],
  },
  {
    id: "prove",
    name: "Prove",
    text: "A finding is only useful when you can trust it, so each one carries its evidence.",
    steps: [
      "Keep the evidence of every attempt",
      "Repeat each test to see how often it works",
      "Score the risk of each target",
    ],
  },
  {
    id: "fix",
    name: "Fix",
    text: "Sentra proposes the fix, a person approves it, and the test runs again.",
    steps: [
      "Review the fixes that Sentra proposes",
      "Enforce policy fixes at the Sentra Shield gateway",
      "Retest, and compare before and after",
    ],
  },
] as const

export type Capability = {
  id: string
  kicker: string
  title: string
  problem: string
  points: string[]
  image: string
  alt: string
  caption: string
}

export const CAPABILITIES: Capability[] = [
  {
    id: "evidence",
    kicker: "Evidence",
    title: "Every finding carries its proof",
    problem:
      "A model that gives way once may not give way twice, and a screenshot is not evidence. Teams need to tell a confirmed weakness from a one-off.",
    points: [
      "Detection combines canary tokens, rule matching, tool-call inspection and an LLM judge, and says which of them agreed.",
      "A reproducibility score repeats the test and counts how often it worked.",
      "The attempt, the target's reply and the detection results are stored read-only with a checksum, and personal data is masked before storage.",
    ],
    image: "/landing/finding-evidence.jpg",
    alt: "A finding's evidence page: three of three repetitions met, the attempt, the tool call and the target's reply, and the detection results of the canary token and the LLM judge.",
    caption: "A finding's evidence: the attempt, the reply, and each detection method's result.",
  },
  {
    id: "attack-paths",
    kicker: "Attack paths",
    title: "See how single weaknesses combine",
    problem:
      "A planted document is one problem and a tool that fetches too much is another. Together they are an attack, and a list of findings hides that.",
    points: [
      "Findings are drawn along the components of the target's own profile: knowledge sources, system prompt, model and tools.",
      "Each path is written out in plain sentences, with the findings on it and their severity.",
      "A list view holds the same paths as text, for readers who don't use the graph.",
    ],
    image: "/landing/attack-paths.jpg",
    alt: "The Attack Paths page: a graph of a RAG application's components with two highlighted nodes, and three attack paths described in sentences with their findings.",
    caption: "Attack paths for a sample RAG application.",
  },
  {
    id: "limits",
    kicker: "Campaigns",
    title: "Test within limits you set, and watch it run",
    problem:
      "Security testing against a live application can overload it, run up a bill or run when nobody is watching.",
    points: [
      "Each campaign has an attempt budget, a request rate that never exceeds the target's safe rate and an optional time window, and the organization has monthly usage and cost limits.",
      "A live monitor shows progress, findings as they appear and warnings, and a run can be paused or stopped at any time.",
      "When the target slows down or can't be reached, the run waits or pauses by itself.",
    ],
    image: "/landing/live-run.jpg",
    alt: "A running campaign: 540 of 870 planned attempts, a request rate of 18 per minute, the cost so far, a feed of live events and three findings found in this run.",
    caption: "A campaign run in progress, with its limits in view.",
  },
  {
    id: "fix",
    kicker: "Remediation",
    title: "Fix it, then prove the fix worked",
    problem:
      "A fix that is never tested again only moves the risk. And a change nobody reviewed is a new risk.",
    points: [
      "Sentra proposes fixes, marked as AI-generated, and a person reviews and approves each one before anything changes.",
      "Guardrail, tool and retrieval policies are enforced by the Sentra Shield gateway in front of your application, and can be rolled back.",
      "Sentra retests the finding and shows the result before and after the fix.",
    ],
    image: "/landing/remediation.jpg",
    alt: "The Remediation page: confirmed findings with their proposed fixes, each with a version, an approval state and a verification result such as Fixed and Verified or Still open.",
    caption: "Fixes from proposal to verified, with who must approve.",
  },
]

export const STEPS = [
  {
    title: "Register and verify the target",
    input: "The endpoint of your chatbot, RAG application or agent, and its credentials.",
    action:
      "Credentials are encrypted and never shown again. You prove ownership with a DNS record or a file on your site.",
    outcome: "The target can be tested. Until it is verified, Sentra runs nothing against it.",
  },
  {
    title: "Choose what to test",
    input: "Built-in tests mapped to the OWASP Top 10 for LLM Applications and MITRE ATLAS, your own tests, or a ready suite.",
    action: "Create a campaign with its budget, rate and time window. Where your organization wants it, a Security Manager approves the scope first.",
    outcome: "A campaign that runs once or on a schedule, within limits written down beforehand.",
  },
  {
    title: "Run it and read the evidence",
    input: "A launched campaign, from the page or from your CI/CD pipeline.",
    action: "Follow the run live. Findings are rated, de-duplicated, and triaged by your team.",
    outcome: "Findings with severity, reproducibility, evidence, and a risk score for each target.",
  },
  {
    title: "Fix and verify",
    input: "A confirmed finding.",
    action: "Review the proposed fix, approve it, apply the change or deploy the policy to the Shield gateway.",
    outcome: "An automatic retest and a before-and-after comparison, kept in a report.",
  },
] as const

export const USE_CASES = [
  {
    role: "AppSec and security teams",
    title: "Assess an AI application before it ships",
    text: "Choose the suites that match the application's threat model, run a campaign against staging, and triage what comes back with the evidence in front of you. Re-run the same suite after every fix.",
  },
  {
    role: "AI application developers",
    title: "Know what to change in your own application",
    text: "Register your application, verify that it is yours, and see the findings on it first. Each finding names the component involved and the fix to review. Then retest and watch the result change.",
  },
  {
    role: "Security leaders",
    title: "Answer “how exposed are we?” with the data",
    text: "A risk score for every target, how it changed since the period began, which framework categories are covered, and a report you can export or schedule. Approve campaign scopes and fixes where your process asks for it.",
  },
  {
    role: "Platform and DevOps teams",
    title: "Put a gate in the release pipeline",
    text: "Start a campaign from CI/CD with the Sentra command line tool and an API key, and let the pipeline stop when the findings break the gate's policy.",
  },
] as const

export const SAFETY = [
  {
    title: "Only what you own",
    text: "Ownership is proved before a target is tested. Private network and cloud metadata addresses can't be registered.",
  },
  {
    title: "Limits before launch",
    text: "A request rate that stays under the target's safe rate, an attempt budget, a time window and monthly usage and cost limits, with pause and stop in the monitor.",
  },
  {
    title: "A person approves changes",
    text: "Sentra proposes fixes. Nothing changes in your application or at the gateway until someone has reviewed and approved it.",
  },
  {
    title: "A record of who did what",
    text: "Roles decide who can do what, two-step verification is available, and the audit log chains its entries so a change to the past shows.",
  },
  {
    title: "Your network stays closed",
    text: "Sentra Shield gateways connect outbound and keep enforcing their last policy if Sentra can't be reached. Sentra never opens a connection into your network.",
  },
  {
    title: "Control over models",
    text: "An administrator can limit the organization to local models, so that its language model calls go only to models you run yourself.",
  },
] as const

export const FAQ = [
  {
    q: "What can I test with Sentra?",
    a: "Chatbots, RAG applications and tool-using agents that your organization owns or is allowed to test. Each one is registered as a target with its endpoint and credentials.",
  },
  {
    q: "How does Sentra know the application is mine?",
    a: "You prove it before any test runs, with a DNS record or a file served from the application's own address. A target that isn't verified can be registered but not tested.",
  },
  {
    q: "How are findings confirmed?",
    a: "Each test has a success condition that Sentra checks with several methods: canary tokens, rule matching, inspection of tool calls and an LLM judge. The finding shows which methods agreed, and a reproducibility score shows how often the test worked when it was repeated.",
  },
  {
    q: "Does Sentra change my application?",
    a: "No. Sentra proposes fixes and a person approves them. Some fixes are policies that the Sentra Shield gateway enforces in front of your application; others are changes your team makes in the application, which Sentra then retests.",
  },
  {
    q: "Where does my data go?",
    a: "Sentra stores evidence in its own database, with personal data masked before storage. Detection and analysis use the language model provider that your administrator configures, and an administrator can limit the organization to local models.",
  },
  {
    q: "Can I run it in CI/CD?",
    a: "Yes. A security gate and the Sentra command line tool start a campaign through the REST API with an API key, and report whether the findings pass the gate's policy.",
  },
  {
    q: "Is there a place to practise first?",
    a: "Yes. The Security Lab deploys intentionally vulnerable applications on an isolated network, so you can see Sentra find real weaknesses without touching your own systems.",
  },
  {
    q: "How do I get access?",
    a: "Create an account, confirm your e-mail address, and create an organization or accept an invitation to one. An organization administrator invites the rest of the team.",
  },
] as const
