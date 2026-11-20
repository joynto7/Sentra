import type { Metadata } from "next"

import { EditTargetForm } from "@/components/targets/edit-target-form"

export const metadata: Metadata = { title: "Edit target" }

export default async function EditTargetPage({ params }: PageProps<"/targets/[id]/edit">) {
  const { id } = await params
  return <EditTargetForm id={id} />
}
