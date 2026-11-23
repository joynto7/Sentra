import { notFound } from "next/navigation"

/** Every platform address the app doesn't have; see (app)/[...section]/page.tsx. */
export default function UnknownPlatformPage() {
  notFound()
}
