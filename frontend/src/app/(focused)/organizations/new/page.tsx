import type { Metadata } from "next"

import { CreateOrganizationForm } from "@/components/organizations/create-organization-form"

export const metadata: Metadata = { title: "Create organization" }

export default function CreateOrganizationPage() {
  return <CreateOrganizationForm />
}
