import type { Metadata } from "next"

import { Welcome } from "@/components/onboarding/welcome"

export const metadata: Metadata = { title: "Welcome" }

export default function WelcomePage() {
  return <Welcome />
}
