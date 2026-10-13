"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { useSession } from "@/components/session-provider"
import { TestCatalogue } from "@/components/test-library/catalogue"
import { SuitesList } from "@/components/test-library/suites-list"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { apiFetch } from "@/lib/api"
import { type CoverageRow, type SuiteItem, listSuites } from "@/lib/test-library"

type Tab = "tests" | "suites"

/** Screen 29: the tabs "Test definitions" and "Test suites" (UC-4.1). The tab is kept in the address. */
export function TestLibrary({ tab }: { tab: Tab }) {
  const router = useRouter()
  const organization = useSession().organization?.name ?? "Your organization"
  const [active, setActive] = useState<Tab>(tab)
  const [coverage, setCoverage] = useState<CoverageRow[]>([])
  const [suites, setSuites] = useState<SuiteItem[] | null>(null)

  useEffect(() => {
    apiFetch<CoverageRow[]>("/v1/test-definitions/coverage")
      .then(setCoverage)
      .catch(() => undefined)
    listSuites()
      .then(setSuites)
      .catch(() => setSuites([]))
  }, [])

  const testCount = coverage.length ? coverage.reduce((sum, row) => sum + row.tests, 0) : null

  return (
    <Tabs
      value={active}
      onValueChange={(value) => {
        setActive(value as Tab)
        router.replace(value === "suites" ? "/test-library?tab=suites" : "/test-library", { scroll: false })
      }}
    >
      <TabsList variant="line" aria-label="Test definitions and test suites" className="mb-5 h-10 w-full justify-start gap-6 border-b px-0">
        <TabsTrigger value="tests" className="flex-none gap-2 px-0.5">
          Test definitions
          <span className="tabular rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{testCount ?? "–"}</span>
        </TabsTrigger>
        <TabsTrigger value="suites" className="flex-none gap-2 px-0.5">
          Test suites
          <span className="tabular rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{suites?.length ?? "–"}</span>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="tests" className="rounded-[10px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <TestCatalogue coverage={coverage} />
      </TabsContent>
      <TabsContent value="suites" className="rounded-[10px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <SuitesList suites={suites} organization={organization} />
      </TabsContent>
    </Tabs>
  )
}
