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
  { id: "find", name: "Find", steps: ["Register and verify your application", "Map its tools and data", "Run tests within your limits"] },
  { id: "prove", name: "Prove", steps: ["Keep the evidence of every attempt", "Repeat each test", "Score the risk"] },
  { id: "fix", name: "Fix", steps: ["Review the proposed fix", "Enforce it at the Shield gateway", "Retest and compare"] },
] as const

export type Capability = {
  id: string
  title: string
  points: string[]
  image: string
  alt: string
  caption: string
}

export const CAPABILITIES: Capability[] = [
  {
    id: "limits",
    title: "Test within limits you set",
    points: [
      "Attempt budget, rate and time window",
      "A live monitor, with pause and stop",
      "It waits when the target slows",
    ],
    image: "/landing/live-run.jpg",
    alt: "A running campaign: 540 of 870 planned attempts, a request rate of 18 per minute, the cost so far, a feed of live events and three findings found in this run.",
    caption: "A campaign run.",
  },
]

export const STEPS = [
  { title: "Register and verify", outcome: "Prove the application is yours. Nothing runs before that." },
  { title: "Choose what to test", outcome: "Pick tests, set the budget, rate and time window." },
  { title: "Run and read the evidence", outcome: "Follow the run live. Findings come with proof." },
  { title: "Fix and verify", outcome: "Approve the fix. Sentra tests it again." },
] as const

export const USE_CASES = [
  { role: "Security teams", title: "Assess an AI application before it ships" },
  { role: "Developers", title: "Know what to change in your own application" },
  { role: "Security leaders", title: "Answer “how exposed are we?” with data" },
  { role: "DevOps teams", title: "Put a gate in the release pipeline" },
] as const

export const SAFETY = [
  { title: "Only what you own", text: "Ownership is proved before any test." },
  { title: "Limits before launch", text: "Budget, rate and time window. Pause or stop any time." },
  { title: "A person approves changes", text: "Nothing changes until someone approves it." },
  { title: "A record of who did what", text: "Roles, two-step verification and a chained audit log." },
  { title: "Your network stays closed", text: "Shield connects outbound only. Nothing opens inward." },
  { title: "Control over models", text: "Limit the organization to local models." },
] as const

export const FAQ = [
  { q: "What can I test?", a: "Chatbots, RAG applications and agents that you own or may test." },
  { q: "How does Sentra know it is mine?", a: "You prove it with a DNS record or a file on your site." },
  { q: "How are findings confirmed?", a: "Several detection methods, and a repeat score." },
  { q: "Does Sentra change my application?", a: "No. A person approves every fix, and Sentra retests it." },
  { q: "Where does my data go?", a: "Evidence stays in Sentra, with personal data masked. Models can be limited to local ones." },
  { q: "Can I run it in CI/CD?", a: "Yes. Use the command line tool and an API key." },
  { q: "Can I practise first?", a: "Yes. The Security Lab has safe, vulnerable sample applications." },
  { q: "How do I get access?", a: "Create an account, then an organization or accept an invitation." },
] as const
