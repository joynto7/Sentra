import type { Metadata } from "next"

import { GettingStartedPage } from "@/components/getting-started/getting-started-page"

export const metadata: Metadata = { title: "Getting started" }

/** Screen 07: the first steps of a new organization (UC-1.6 step 6). */
export default function GettingStarted() {
  return <GettingStartedPage />
}
