import { redirect } from "next/navigation"

/** The account opens on the profile. */
export default function AccountPage() {
  redirect("/account/profile")
}
