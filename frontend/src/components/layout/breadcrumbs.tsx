"use client"

import { createContext, useContext, useEffect, useState } from "react"

/** One step after the navigation item in the breadcrumb, e.g. a target's name, then "Edit". */
export type Crumb = { label: string; href?: string }

type CrumbState = { crumbs: Crumb[]; setCrumbs: (crumbs: Crumb[]) => void }

const CrumbContext = createContext<CrumbState | null>(null)

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  return <CrumbContext.Provider value={{ crumbs, setCrumbs }}>{children}</CrumbContext.Provider>
}

/** A page adds its own steps to the breadcrumb ("Testing / Targets / <name> / Edit"). */
export function usePageCrumbs(crumbs: Crumb[]) {
  const setCrumbs = useContext(CrumbContext)?.setCrumbs
  // The JSON text stands for the crumbs, so a new array with the same content changes nothing.
  const key = JSON.stringify(crumbs)
  useEffect(() => {
    setCrumbs?.(JSON.parse(key))
    return () => setCrumbs?.([])
  }, [key, setCrumbs])
}

export function usePageCrumbsValue(): Crumb[] {
  return useContext(CrumbContext)?.crumbs ?? []
}
