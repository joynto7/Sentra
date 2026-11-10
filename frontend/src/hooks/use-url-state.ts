"use client"

import { useEffect, useEffectEvent, useRef } from "react"
import { useSearchParams } from "next/navigation"

/** The address for these values: a value that is empty or the same as its default is left out. */
function queryOf(values: Record<string, string>, defaults: Record<string, string>) {
  return new URLSearchParams(
    Object.entries(values).filter(([key, value]) => value !== "" && value !== defaults[key]),
  ).toString()
}

/**
 * Keeps what a list shows in its own address: its view, filters, sort and page, so that reloading
 * the page, sharing the link or coming back to it opens the same list. A value that is empty or
 * the same as its default is left out, so a plain list keeps a plain address. Give every key the
 * list can have, also the empty ones, so that the address and the list can be compared.
 *
 * It replaces the current entry of the browser's history instead of adding one, so the Back button
 * leaves the list instead of undoing one filter at a time.
 *
 * When the address changes without the list (the menu's link to the same page, or Back and Forward
 * between two addresses of it), `onOutside` is called, so that the list can start again from the
 * new address.
 */
export function useUrlState(
  values: Record<string, string>,
  defaults: Record<string, string>,
  onOutside: () => void,
) {
  const query = queryOf(values, defaults)
  // The address as the list would write it: its own values only, in the same order
  const address = useSearchParams()
  const shown = queryOf(
    Object.fromEntries(Object.keys(values).map((key) => [key, address.get(key) ?? ""])),
    defaults,
  )
  // What the list wrote that the address may not show yet: the router takes it over a moment
  // later. The address the list was opened with counts as its own.
  const written = useRef([shown, query])
  const outside = useEffectEvent(onOutside)

  useEffect(() => {
    const at = written.current.indexOf(shown)
    if (at >= 0) written.current = written.current.slice(at)
    else outside()
  }, [shown])

  useEffect(() => {
    written.current.push(query)
    const next = `${window.location.pathname}${query ? `?${query}` : ""}`
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", next)
    }
  }, [query])
}
