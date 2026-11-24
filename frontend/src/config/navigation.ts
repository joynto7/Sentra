import type { LucideIcon } from "lucide-react"
import {
  Activity,
  Bot,
  Building2,
  Bug,
  ClipboardList,
  FileText,
  FlaskConical,
  Gauge,
  Library,
  Plug,
  Rocket,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Target,
  UsersRound,
  Waypoints,
  Wrench,
} from "lucide-react"

export type Role =
  | "security_analyst"
  | "target_owner"
  | "security_manager"
  | "org_admin"
  | "platform_admin"

export type NavItem = {
  title: string
  href: string
  icon: LucideIcon
  /** Module that builds this page (see the development plan). */
  module: string
  /** Only these roles see the item; all roles when omitted. */
  roles?: Role[]
}

export type NavGroup = { label: string; items: NavItem[] }

/** Sidebar navigation, exactly as in the UI plan (app shell). */
export const navigation: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { title: "Risk Dashboard", href: "/dashboard", icon: Gauge, module: "M7" },
      { title: "Attack Paths", href: "/attack-paths", icon: Waypoints, module: "M7" },
      { title: "Framework Coverage", href: "/framework-coverage", icon: ClipboardList, module: "M7" },
    ],
  },
  {
    label: "Testing",
    items: [
      { title: "Targets", href: "/targets", icon: Target, module: "M2" },
      { title: "Threat Models", href: "/threat-models", icon: ShieldCheck, module: "M3" },
      { title: "Test Library", href: "/test-library", icon: Library, module: "M4" },
      { title: "Campaigns", href: "/campaigns", icon: Rocket, module: "M5" },
      { title: "Autopilot", href: "/autopilot", icon: Sparkles, module: "M5", roles: ["security_analyst", "security_manager", "org_admin"] },
    ],
  },
  {
    label: "Response",
    items: [
      { title: "Findings", href: "/findings", icon: Bug, module: "M6" },
      { title: "Remediation", href: "/remediation", icon: Wrench, module: "M8" },
      { title: "Sentra Shield", href: "/shield", icon: Shield, module: "M8" },
    ],
  },
  {
    label: "Governance",
    items: [
      { title: "Reports", href: "/reports", icon: FileText, module: "M9" },
      { title: "Integrations", href: "/integrations", icon: Plug, module: "M9" },
      { title: "Audit Log", href: "/audit-log", icon: ScrollText, module: "M10", roles: ["org_admin"] },
      { title: "Administration", href: "/admin", icon: Settings, module: "M10", roles: ["org_admin"] },
    ],
  },
  {
    label: "Research",
    items: [{ title: "Security Lab", href: "/lab", icon: FlaskConical, module: "M11" }],
  },
]

/**
 * The Platform Administrator's shell (UI plan, Screens 61-64): the same layout with one PLATFORM
 * group, for operating Sentra itself. It is not an organization role (report 2.4), so these pages
 * live under /platform and never show an organization's content.
 */
export const platformNavigation: NavGroup[] = [
  {
    label: "Platform",
    items: [
      { title: "Overview", href: "/platform", icon: Gauge, module: "M10" },
      { title: "Organizations", href: "/platform/organizations", icon: Building2, module: "M10" },
      { title: "Accounts", href: "/platform/accounts", icon: UsersRound, module: "M10" },
      { title: "LLM Providers", href: "/platform/llm-providers", icon: Bot, module: "M10" },
      { title: "System Health", href: "/platform/health", icon: Activity, module: "M10" },
      { title: "Platform Audit Log", href: "/platform/audit-log", icon: ScrollText, module: "M10" },
    ],
  },
]

export function visibleNavigation(role: Role): NavGroup[] {
  return navigation
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.roles || item.roles.includes(role)),
    }))
    .filter((group) => group.items.length > 0)
}

export function findNavItem(pathname: string): { group: NavGroup; item: NavItem } | undefined {
  // The most specific address wins: "/platform" is the Overview, "/platform/health" is System Health
  let best: { group: NavGroup; item: NavItem } | undefined
  for (const group of [...navigation, ...platformNavigation]) {
    for (const item of group.items) {
      const matches = pathname === item.href || pathname.startsWith(`${item.href}/`)
      if (matches && (!best || item.href.length > best.item.href.length)) best = { group, item }
    }
  }
  return best
}
