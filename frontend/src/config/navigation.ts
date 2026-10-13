import type { LucideIcon } from "lucide-react"
import {
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
  Target,
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

export function visibleNavigation(role: Role): NavGroup[] {
  return navigation
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.roles || item.roles.includes(role)),
    }))
    .filter((group) => group.items.length > 0)
}

export function findNavItem(pathname: string): { group: NavGroup; item: NavItem } | undefined {
  for (const group of navigation) {
    const item = group.items.find(
      (i) => pathname === i.href || pathname.startsWith(`${i.href}/`),
    )
    if (item) return { group, item }
  }
  return undefined
}
