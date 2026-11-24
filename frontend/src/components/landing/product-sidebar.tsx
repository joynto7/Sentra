import { Bug, Crosshair, FileText, LayoutDashboard, Library, Megaphone, Network, Radar, ShieldCheck, Wrench, type LucideIcon } from "lucide-react"

import { SentraLogo, SentraWordmark } from "@/components/layout/sentra-logo"

/** The product's own left menu, in its own order and colours: the navy bar, the group names, the chosen item. */
const MENU: { group: string; items: [string, LucideIcon][] }[] = [
  { group: "Overview", items: [["Risk Dashboard", LayoutDashboard], ["Attack Paths", Network], ["Framework Coverage", Radar]] },
  { group: "Testing", items: [["Targets", Crosshair], ["Threat Models", ShieldCheck], ["Test Library", Library], ["Campaigns", Megaphone]] },
  { group: "Response", items: [["Findings", Bug], ["Remediation", Wrench], ["Sentra Shield", FileText]] },
]

/**
 * The left menu of the product as a picture, with the real logo and wordmark: a window on the landing
 * page uses it so that the product looks the same there as in the app. It is hidden from readers (it is
 * furniture of the picture) and from phones, where the window keeps only what matters.
 */
export function ProductSidebar({ active, collapsed = false, className }: { active: string; collapsed?: boolean; className?: string }) {
  if (collapsed) {
    // The app's collapsed bar: the logo, one icon for each item, the person at the bottom
    return (
      <div aria-hidden="true" className={`hidden w-12 shrink-0 flex-col items-center gap-1 py-4 sm:flex ${className ?? ""}`} style={{ background: "#0e1322", color: "#c3cad8" }}>
        <SentraLogo size={26} />
        {MENU.map((group) => (
          <div key={group.group} className="mt-3 flex flex-col items-center gap-0.5">
            {group.items.map(([label, Icon]) => (
              <span key={label} className="grid size-8 place-items-center rounded-lg" style={{ background: label === active ? "#242d48" : "transparent", color: label === active ? "#ffffff" : "#c3cad8" }}>
                <Icon className="size-4" />
              </span>
            ))}
          </div>
        ))}
        <span className="mt-auto grid size-8 place-items-center rounded-full bg-[#2b4fd8] text-[11px] font-semibold text-white">AH</span>
      </div>
    )
  }
  return (
    <div aria-hidden="true" className={`hidden w-48 shrink-0 flex-col px-3 py-4 sm:flex ${className ?? ""}`} style={{ background: "#0e1322", color: "#c3cad8" }}>
      <div className="flex items-center gap-2.5 px-1.5">
        <SentraLogo size={26} />
        <SentraWordmark size={14} onDark className="text-white" />
      </div>
      {MENU.map((group) => (
        <div key={group.group} className="mt-5">
          <p className="px-2 text-[10px] font-medium tracking-wider uppercase" style={{ color: "#8c96aa" }}>
            {group.group}
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {group.items.map(([label, Icon]) => (
              <li
                key={label}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12px] whitespace-nowrap"
                style={{ background: label === active ? "#242d48" : "transparent", color: label === active ? "#ffffff" : "#c3cad8" }}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="mt-auto flex items-center gap-2.5 px-1.5 pt-4">
        <span className="grid size-8 place-items-center rounded-full bg-[#2b4fd8] text-[11px] font-semibold text-white">AH</span>
        <span className="leading-tight">
          <span className="block text-[12px] text-white">Arif Hossain</span>
          <span className="block text-[11px]" style={{ color: "#8c96aa" }}>
            Security Analyst
          </span>
        </span>
      </div>
    </div>
  )
}
