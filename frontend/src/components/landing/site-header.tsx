"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Menu, X } from "lucide-react"

import { NAV } from "@/components/landing/landing-content"
import { SentraLogo } from "@/components/layout/sentra-logo"
import { Button } from "@/components/ui/button"

/**
 * The header of the public page: the product, four links that lead further down the same page,
 * "Log in" (the real log in page) and the one primary action, "Create account" (the real
 * registration page). Below 768 px the links fold into a menu that opens with a button; Escape
 * closes it, and so does choosing a link.
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false)
    window.addEventListener("keydown", close)
    return () => window.removeEventListener("keydown", close)
  }, [open])

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md text-lg font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <SentraLogo size={30} />
          Sentra
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm text-text-secondary outline-none motion-safe:transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden rounded-md px-3 py-2 text-sm font-medium text-foreground outline-none hover:text-link focus-visible:ring-2 focus-visible:ring-ring sm:inline-block"
          >
            Log in
          </Link>
          <Button asChild className="hidden h-9 px-4 sm:inline-flex">
            <Link href="/register">Create account</Link>
          </Button>
          <Button
            variant="outline"
            size="icon-lg"
            className="md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close the menu" : "Open the menu"}
            onClick={() => setOpen((now) => !now)}
          >
            {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </Button>
        </div>
      </div>

      {open && (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-border/70 bg-background md:hidden">
          <ul className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3 sm:px-6">
            {NAV.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-md px-3 py-3 text-base text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {item.label}
                </a>
              </li>
            ))}
            <li className="mt-2 grid grid-cols-2 gap-2 border-t border-border/70 pt-3">
              <Button asChild variant="outline" className="h-11">
                <Link href="/login">Log in</Link>
              </Button>
              <Button asChild className="h-11">
                <Link href="/register">Create account</Link>
              </Button>
            </li>
          </ul>
        </nav>
      )}
    </header>
  )
}
