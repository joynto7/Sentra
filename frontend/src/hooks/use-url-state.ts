"use client"

import { useEffect } from "react"

/**
 * Keeps what a list shows in its own address: its view, filters, sort and page, so that reloading
 * the page, sharing the link or coming back to it opens the same list. A value that is empty or
 * the same as its default is left out, so a plain list keeps a plain address.
 *
 * It replaces the current entry of the browser's history instead of adding one, so the Back button
 * leaves the list instead of undoing one filter at a time.
 */
export function useUrlState(values: Record<string, string>, defaults: Record<string, string> = {}) {
  const query = new URLSearchParams(
    Object.entries(values).filter(([key, value]) => value !== "" && value !== defaults[key]),
  ).toString()

  useEffect(() => {
    const next = `${window.location.pathname}${query ? `?${query}` : ""}`
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", next)
    }
  }, [query])
}
