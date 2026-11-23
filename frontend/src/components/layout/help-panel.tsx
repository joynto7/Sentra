"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CircleHelp } from "lucide-react"

import { useSession } from "@/components/session-provider"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { ROLE_NAMES, helpFor, type HelpTopic } from "@/config/help"

function WhoCan({ topic }: { topic: HelpTopic }) {
  const user = useSession()
  const mine = user.organization?.role
  return (
    <ul className="mt-2 space-y-2">
      {topic.who.map(({ roles, can }) => {
        const names =
          roles === "everyone"
            ? "Every member"
            : roles === "platform"
              ? "Platform Administrators"
              : roles.map((role) => ROLE_NAMES[role]).join(", ")
        const yours =
          roles === "everyone" ||
          (roles === "platform" ? user.platform_admin : (roles as string[]).includes(mine ?? ""))
        return (
          <li key={`${names}-${can}`} className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
            <span className="font-medium">{names}:</span>
            <span className="text-muted-foreground">{can}</span>
            {yours && (
              <span className="rounded bg-accent px-1.5 text-xs font-medium text-accent-foreground">
                You
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The help of the top bar: what this page is, what to do on it and who can do what. It is always in
 * the same place on every page (WCAG 3.2.6), and it is the in-context help NFR-4.1 relies on. The
 * panel holds the focus while it is open, and gives it back to the button when it closes.
 */
export function HelpPanel() {
  const pathname = usePathname()
  const user = useSession()
  const topic = helpFor(pathname)
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Help">
          <CircleHelp aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-[480px]">
        <SheetHeader className="border-b p-5 pr-12">
          <p className="text-xs font-medium text-muted-foreground">Help</p>
          <SheetTitle className="text-[15px] font-semibold">{topic.title}</SheetTitle>
          <SheetDescription className="mt-1 text-sm text-muted-foreground">{topic.what}</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 p-5">
          <section>
            <h3 className="text-sm font-semibold">What to do here</h3>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground marker:text-foreground">
              {topic.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
          {topic.who.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold">Who can do what</h3>
              <WhoCan topic={topic} />
            </section>
          )}
          {user.organization && (
            <section className="border-t pt-5 text-sm text-muted-foreground">
              New to Sentra?{" "}
              <SheetClose asChild>
                <Link href="/getting-started" className="text-[var(--link)] underline underline-offset-2">
                  Start with Getting Started
                </Link>
              </SheetClose>
              . Press ⌘K or Ctrl K anywhere to search.
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
