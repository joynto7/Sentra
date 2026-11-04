"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import dynamic from "next/dynamic"
import { Search } from "lucide-react"

import { Button } from "@/components/ui/button"

// Its code, and that of cmdk, load only when someone searches, so no page gets heavier for it.
const SearchDialog = dynamic(() => import("@/components/layout/search-dialog"), { ssr: false })

const NAME = "Search targets, findings, campaigns"
const nothingToWatch = () => () => {}

/** The hint shows the key this computer has. Before the browser is known, the page shows ⌘K, as the
 * design does; a useState and useEffect would draw the page twice. */
function useIsMac() {
  return useSyncExternalStore(
    nothingToWatch,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => true,
  )
}

/** The search of the top bar: it looks like a field, and opens the search dialog on a click or ⌘K. */
export function SearchBox() {
  const [open, setOpen] = useState(false)
  const isMac = useIsMac()

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault() // the browser's own use of the key
        setOpen(true)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        onClick={() => setOpen(true)}
        className="relative mr-2 hidden h-9 w-80 items-center rounded-[7px] border border-input bg-card pr-10 pl-8 text-left text-sm text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring lg:flex"
      >
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden="true" />
        <span className="truncate">{NAME}</span>
        <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border px-1.5 font-mono text-[11px]">
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={NAME}
        aria-haspopup="dialog"
        className="lg:hidden"
        onClick={() => setOpen(true)}
      >
        <Search aria-hidden="true" />
      </Button>
      {open && <SearchDialog onClose={() => setOpen(false)} />}
    </>
  )
}
