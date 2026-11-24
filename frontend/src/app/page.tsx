import type { Metadata } from "next"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { LandingPage } from "@/components/landing/landing-page"

const TITLE = "Sentra: find, prove and fix the weaknesses in your AI applications"
const DESCRIPTION =
  "Sentra tests the chatbots, RAG systems and tool-using agents that you own or are allowed to test, keeps the evidence of every finding, and tests each approved fix again."

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "Sentra" },
}

/**
 * The address of the product. Someone with a session goes on to the dashboard, as this page always
 * did (the API still checks the session); everybody else sees the public page.
 */
export default async function Home() {
  if ((await cookies()).has("sentra_session")) redirect("/dashboard")
  return <LandingPage />
}
