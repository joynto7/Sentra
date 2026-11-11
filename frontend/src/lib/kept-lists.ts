/**
 * The memory of Back to a list (UX task 3.0): each list's last answer and the reader's position in
 * it, per person, organization and request (hooks/use-kept-list.ts). Plain memory only — nothing is
 * written to the browser's storage, so a reload starts empty.
 */
const KEEP = 24 // answers and positions kept each; the one used longest ago goes first

export const kept = new Map<string, unknown>()
export const scrolls = new Map<string, number>()
// The view each list was left in (its tab, filters, sort and page): Back only brings the reader
// back into that view, never to a position the reader had in another one
export const left = new Map<string, string>()

export function put<T>(map: Map<string, T>, key: string, value: T) {
  map.delete(key) // set again, so it counts as used last
  map.set(key, value)
  while (map.size > KEEP) map.delete(map.keys().next().value as string)
}

/** Every logout forgets every list, so the next person in this browser never sees the last one's. */
export function forgetKeptLists() {
  kept.clear()
  scrolls.clear()
  left.clear()
}

// Back and Forward are the only moves that bring a list back to where the reader was in it.
let poppedAt = 0
let listening = false

export function listenForBackAndForward() {
  if (listening) return
  listening = true
  window.addEventListener("popstate", () => {
    poppedAt = Date.now()
  })
}

/** True right after Back or Forward. */
export function cameBack(): boolean {
  return Date.now() - poppedAt < 2000
}
