"use client"

import "./globals.css"

/** The last resort, when the root layout itself breaks. It replaces the whole document, so it has
 * its own html and body, and nothing from the app's providers is available here. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="bg-background font-sans text-foreground">
        <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
          <h1 className="text-lg font-semibold">Sentra couldn&apos;t be shown</h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Something went wrong on Sentra&apos;s side. Try again. If it keeps happening, tell your
            administrator.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-5 h-9 rounded-[7px] bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  )
}
