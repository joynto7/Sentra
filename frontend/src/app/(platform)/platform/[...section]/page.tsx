import { notFound } from "next/navigation"

import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { findNavItem } from "@/config/navigation"

/** Placeholder for every platform menu item whose page is not built yet (Organizations,
 * LLM Providers and System Health come with FR-10.3, FR-10.4 and FR-10.6). */
export default async function PlatformSectionPlaceholder({ params }: PageProps<"/platform/[...section]">) {
  const { section } = await params
  const match = findNavItem(`/platform/${section.join("/")}`)
  if (!match) notFound()

  return (
    <>
      <PageHeader title={match.item.title} description={`Part of module ${match.item.module}.`} />
      <EmptyState
        title="This page is not built yet"
        description={`${match.item.title} will appear here when its part of module ${match.item.module} is implemented.`}
      />
    </>
  )
}
