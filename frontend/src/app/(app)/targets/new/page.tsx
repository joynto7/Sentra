import type { Metadata } from "next"

import { RegisterWizard } from "@/components/targets/register-wizard"

export const metadata: Metadata = { title: "Register Target" }

export default function RegisterTargetPage() {
  return <RegisterWizard />
}
