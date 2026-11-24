import { Layers, Lock, Package, ShieldAlert } from "lucide-react"

import { Bar, LibraryCard } from "@/components/sentra/library-card"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import { ORIGIN_LABEL, type SuiteItem, TARGET_TYPE_LABEL, type TestSummary } from "@/lib/test-library"

const TYPE_COUNT = Object.keys(TARGET_TYPE_LABEL).length

function Origin({ origin, organization }: { origin: string; organization: string }) {
  const custom = origin === "custom"
  return (
    <span className="inline-flex items-center gap-1.5">
      {custom ? <Lock className="size-3.5" aria-hidden="true" /> : <Package className="size-3.5" aria-hidden="true" />}
      {custom ? `${organization} only` : (ORIGIN_LABEL[origin] ?? origin)}
    </span>
  )
}

/** Screen 29's test definitions as cards: the same facts as a row, one test to a card. */
export function TestCard({
  test,
  categoryName,
  organization,
}: {
  test: TestSummary
  categoryName: string | undefined
  organization: string
}) {
  const types =
    test.target_types.length === TYPE_COUNT
      ? "All types"
      : test.target_types.map((type) => TARGET_TYPE_LABEL[type] ?? type).join(", ")
  return (
    <LibraryCard
      href={`/test-library/${test.code}`}
      icon={<ShieldAlert className="size-5" />}
      kind={categoryName ?? test.category}
      title={test.name}
      subtitle={types}
      label={`${test.code}: ${test.name}`}
      footer={
        <>
          <Origin origin={test.origin} organization={organization} />
          <Bar />
          <SeverityBadge severity={test.severity} />
          <Bar />
          <span className="tabular">v{test.version}</span>
        </>
      }
    />
  )
}

/** The test suites as cards: what a suite is for, how many tests it holds and what a run costs. */
export function SuiteCard({ suite, organization }: { suite: SuiteItem; organization: string }) {
  return (
    <LibraryCard
      href={`/test-library/suites/${suite.code}`}
      icon={<Layers className="size-5" />}
      kind="Test suite"
      title={suite.name}
      subtitle={suite.purpose}
      footer={
        <>
          <Origin origin={suite.origin} organization={organization} />
          <Bar />
          <span className="tabular">
            {suite.test_count} {suite.test_count === 1 ? "test" : "tests"}
          </span>
          <Bar />
          <span className="tabular">v{suite.version}</span>
        </>
      }
    />
  )
}
