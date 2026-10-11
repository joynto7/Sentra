import { notFound } from "next/navigation"

import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { ApiStatus } from "@/components/sentra/api-status"
import { findNavItem } from "@/config/navigation"

/**
 * Placeholder for every navigation item whose page is not built yet.
 * A module replaces it by adding its own route folder, e.g. src/app/(app)/targets/page.tsx.
 */
export default async function SectionPlaceholder({ params }: PageProps<"/[...section]">) {
  const { section } = await params
  const match = findNavItem(`/${section.join("/")}`)
  if (!match) notFound()

  return (
    <>
      <PageHeader title={match.item.title} description={`Part of module ${match.item.module}.`} />
      <EmptyState
        title="This page is not built yet"
        description={`${match.item.title} will appear here when module ${match.item.module} is implemented.`}
      />
      <div className="mt-6">
        <ApiStatus />
      </div>
    </>
  )
}
