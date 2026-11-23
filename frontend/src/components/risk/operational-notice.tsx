import Link from "next/link"
import { ArrowRight, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * One line of "Needs your attention": an icon, what is the case, and where it opens. A notice that
 * is a problem (a gateway that isn't reporting, a limit that is reached) says so with the warning
 * colour and a heavier line, never with colour alone: its words say it too.
 */
export function OperationalNotice({
  icon: Icon,
  href,
  tone = "normal",
  children,
}: {
  icon: LucideIcon
  href?: string
  tone?: "normal" | "warning"
  children: React.ReactNode
}) {
  const shape = cn(
    "flex min-h-9 items-start gap-2.5 rounded-[7px] border px-3 py-2 text-[13px] leading-snug",
    tone === "warning" ? "border-warning/50 bg-warning/5 font-medium text-warning" : "bg-card",
  )
  const body = (
    <>
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "warning" ? "text-warning" : "text-muted-foreground")} aria-hidden="true" />
      <span className="min-w-0 flex-1">{children}</span>
    </>
  )
  if (!href) return <p className={cn(shape, tone === "warning" ? "" : "bg-muted/40")}>{body}</p>
  return (
    <Link
      href={href}
      className={cn(shape, "group hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none")}
    >
      {body}
      <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
    </Link>
  )
}
