import { notFound } from "next/navigation"

/** Every address the app doesn't have. It ends in (app)/not-found.tsx, inside the shell: a route
 * group's not-found page shows only when something inside the group calls notFound(). */
export default function UnknownPage() {
  notFound()
}
