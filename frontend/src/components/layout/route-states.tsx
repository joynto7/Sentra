"use client"

import { useEffect, useRef } from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export type Home = { href: string; label: string }

/** While a page's code and first data are on their way. Its parts appear only after 200 ms
 * (the skeleton class in globals.css), so a fast page shows nothing in between. */
export function RouteLoading() {
  return (
    <div role="status" aria-label="Loading the page">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <Skeleton className="mt-8 h-24 w-full rounded-[10px]" />
      <Skeleton className="mt-4 h-72 w-full rounded-[10px]" />
    </div>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-10 flex max-w-xl flex-col items-center rounded-[10px] border bg-card px-6 py-12 text-center">
      {children}
    </div>
  )
}

/** An address the app doesn't have, or an item that no longer exists. */
export function RouteNotFound({ home }: { home: Home }) {
  return (
    <Panel>
      <h1 className="text-lg font-semibold">This page doesn&apos;t exist</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        The address may be mistyped, or the page may have moved. Everything else in Sentra is where it
        was.
      </p>
      <Button asChild className="mt-5 h-9 hover:bg-primary-hover">
        <Link href={home.href}>{home.label}</Link>
      </Button>
    </Panel>
  )
}

/** A page that broke while it was shown. The cause stays in the server's log, not on the screen. The
 * focus moves here, so someone using a screen reader hears what happened. */
export function RouteError({
  error,
  reset,
  home,
}: {
  error: Error & { digest?: string }
  reset: () => void
  home: Home
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [])
  return (
    <Panel>
      <h1 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">
        This page couldn&apos;t be shown
      </h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Something went wrong on Sentra&apos;s side. Try again. If it keeps happening, tell your
        administrator
        {error.digest ? (
          <>
            {" "}
            and give this reference: <span className="font-mono">{error.digest}</span>
          </>
        ) : null}
        .
      </p>
      <div className="mt-5 flex items-center gap-2">
        <Button className="h-9 hover:bg-primary-hover" onClick={reset}>
          Try again
        </Button>
        <Button asChild variant="outline" className="h-9">
          <Link href={home.href}>{home.label}</Link>
        </Button>
      </div>
    </Panel>
  )
}
