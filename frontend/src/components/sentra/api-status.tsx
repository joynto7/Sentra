"use client"

import { useEffect, useState } from "react"

import { apiFetch } from "@/lib/api"

type Health = { status: string; database: string; version: string }

/** Shows whether the web app can reach the API (useful while developing). */
export function ApiStatus() {
  const [health, setHealth] = useState<Health | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    apiFetch<Health>("/health")
      .then(setHealth)
      .catch(() => setFailed(true))
  }, [])

  const text = failed
    ? "API not reachable"
    : health
      ? `API ${health.status} · database ${health.database} · v${health.version}`
      : "Checking API…"

  return (
    <p className="font-mono text-xs text-muted-foreground" role="status">
      <span
        className={`mr-2 inline-block size-2 rounded-full ${failed ? "bg-destructive" : health ? "bg-success" : "bg-border-strong"}`}
        aria-hidden="true"
      />
      {text}
    </p>
  )
}
