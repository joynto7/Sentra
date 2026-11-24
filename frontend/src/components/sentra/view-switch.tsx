"use client"

import { useCallback, useState } from "react"
import { LayoutGrid, List } from "lucide-react"

import { cn } from "@/lib/utils"

export type View = "list" | "cards"

/** List or Cards: two buttons, the one in use pressed. */
export function ViewSwitch({ value, onChange }: { value: View; onChange: (view: View) => void }) {
  return (
    <div role="group" aria-label="View" className="flex rounded-[7px] border border-input p-0.5">
      {(
        [
          ["list", "List", List],
          ["cards", "Cards", LayoutGrid],
        ] as const
      ).map(([id, label, Icon]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-[5px] px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  )
}

/**
 * The view a list is in, kept for the browser tab (not the address): going from one tab of the page
 * to another, or away and back, keeps the choice. Cards are the first look.
 */
export function useStoredView(key: string): [View, (view: View) => void] {
  const [view, setView] = useState<View>(() => {
    try {
      return window.sessionStorage.getItem(`view:${key}`) === "list" ? "list" : "cards"
    } catch {
      return "cards"
    }
  })
  const choose = useCallback(
    (next: View) => {
      setView(next)
      try {
        window.sessionStorage.setItem(`view:${key}`, next)
      } catch {
        // storage is off: the choice lasts until the page is left
      }
    },
    [key],
  )
  return [view, choose]
}
