"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

import { useSession } from "@/components/session-provider"
import { ApiError } from "@/lib/api"
import { cameBack, kept, left, listenForBackAndForward, put, scrolls } from "@/lib/kept-lists"

/**
 * Back to a list (UX task 3.0). Coming back to a list used to show a page of skeletons while it
 * asked the API again, and to open at the top although the reader had been halfway down it.
 *
 * Now the last answer of each list request is kept in memory, so the list shows it at once and
 * refreshes it behind; and Back or Forward bring the reader to where they were in it. A link to
 * the list, such as the menu's, opens it at the top as before.
 *
 * Nothing is written to the browser's storage (lib/kept-lists.ts): a reload starts empty, so does
 * another organization (switching reloads the page), and a logout forgets everything. The answers
 * are also kept apart per person and organization, so nobody ever sees another person's list.
 */
function useKey(request: string): string {
  const user = useSession()
  return `${user.id}|${user.organization?.id ?? ""}|${request}`
}

/** The API refused the list (the session ended, or the role may no longer read it). */
export function refused(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403)
}

/**
 * The list's last answer to this request, if it was asked before; `keep` for each new one; and
 * `drop`, for when the API refuses the list (`refused`): what the reader may no longer read leaves
 * the memory, and the list clears its rows. `request` is everything that decides the answer, e.g.
 * "findings?view=open&page=2".
 */
export function useKeptAnswer<T>(request: string): [T | null, (answer: T) => void, () => void] {
  const key = useKey(request)
  const [first] = useState(() => (kept.get(key) as T | undefined) ?? null)
  const keep = useCallback((answer: T) => put(kept, key, answer), [key])
  const drop = useCallback(() => {
    kept.delete(key)
  }, [key])
  return [first, keep, drop]
}

/**
 * Remembers where the reader is in the list while it is open, and after Back or Forward scrolls
 * back there once the list is `ready` (its rows are on the page). `list` names the list, e.g.
 * "targets"; `place` the view of it the reader sees, e.g. "targets?tab=archived&page=2". The
 * position comes back only into the view the reader left: a list whose tab or filters aren't in
 * its address opens in its first view after Back, and then at the top.
 */
export function useKeptScroll(list: string, place: string, ready: boolean) {
  const key = useKey(place)
  const listKey = useKey(list)
  const restored = useRef(false)
  const back = useRef(false)
  const at = useRef(0)

  // Whether the list opened because of Back or Forward, decided when it opens: its rows may come
  // only later
  useLayoutEffect(() => {
    back.current = cameBack()
  }, [])

  // The position is written when the list closes or changes its view. A layout effect's cleanup
  // runs in the very commit that replaces the list, before the next page scrolls to its own top.
  useLayoutEffect(() => {
    listenForBackAndForward()
    const remember = () => {
      at.current = window.scrollY
    }
    remember()
    window.addEventListener("scroll", remember, { passive: true })
    return () => {
      window.removeEventListener("scroll", remember)
      put(scrolls, key, at.current)
      left.set(listKey, key)
    }
  }, [key, listKey])

  useEffect(() => {
    if (!ready || restored.current) return
    restored.current = true
    const top = scrolls.get(key) ?? 0
    // The router scrolls to the top first, so this goes after it
    if (back.current && left.get(listKey) === key && top > 0) {
      requestAnimationFrame(() => window.scrollTo({ top }))
    }
  }, [ready, key, listKey])
}
