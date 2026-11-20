import { redirect } from "next/navigation"

/** The suites are a tab of the Test Library. */
export default function TestSuitesPage() {
  redirect("/test-library?tab=suites")
}
