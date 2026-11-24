import Link from "next/link"

import { IntegrationsGuide } from "@/components/integrations/integrations-guide"
import { cn } from "@/lib/utils"

export type IntegrationsTab = "gates" | "keys" | "webhooks"

const TABS: { id: IntegrationsTab; label: string; href: string }[] = [
  { id: "gates", label: "Security gates", href: "/integrations" },
  { id: "keys", label: "API keys", href: "/integrations/api-keys" },
  { id: "webhooks", label: "Webhooks", href: "/integrations/webhooks" },
]

const SHARED = "flex h-10 items-center border-b-2 px-0.5 text-sm whitespace-nowrap"

/**
 * The three parts of Integrations (Screens 55, 56 and 57). They are links in a `nav` with
 * `aria-current`, not a tab widget, because each is a page of its own that a person can keep or
 * share — tab roles belong to controls that switch a panel in place (WCAG 4.1.2).
 */
export function IntegrationsTabs({ active }: { active: IntegrationsTab }) {
  return (
    <>
    <nav aria-label="Integrations" className="mb-5 overflow-x-auto border-b">
      <ul className="flex gap-6">
        {TABS.map((tab) => (
          <li key={tab.id}>
            <Link
              href={tab.href}
              aria-current={tab.id === active ? "page" : undefined}
              className={cn(
                SHARED,
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                tab.id === active
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-text-secondary hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
    <IntegrationsGuide active={active} />
    </>
  )
}
