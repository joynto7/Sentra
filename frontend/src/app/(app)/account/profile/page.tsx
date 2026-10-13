import type { Metadata } from "next"

import { ProfilePage } from "@/components/account/profile-page"

export const metadata: Metadata = { title: "Profile" }

export default function AccountProfilePage() {
  return <ProfilePage />
}
