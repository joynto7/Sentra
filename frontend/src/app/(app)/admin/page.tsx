import { redirect } from "next/navigation"

/** Administration opens its first page, Members. */
export default function AdminPage() {
  redirect("/admin/members")
}
