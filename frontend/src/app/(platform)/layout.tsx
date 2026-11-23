import { cookies } from "next/headers"

import { AppSidebar } from "@/components/layout/app-sidebar"
import { BreadcrumbProvider } from "@/components/layout/breadcrumbs"
import { SkipLink } from "@/components/layout/skip-link"
import { TopBar } from "@/components/layout/top-bar"
import { PlatformGuard } from "@/components/platform/platform-guard"
import { SessionProvider } from "@/components/session-provider"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"

/** The Platform Administrator's shell (UI plan, Screen 61): the app's layout with the PLATFORM
 * menu. A Platform Administrator needs no organization here. */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false"

  return (
    <SessionProvider requireOrganization={false}>
      <PlatformGuard>
        <BreadcrumbProvider>
          <SkipLink />
          <SidebarProvider defaultOpen={defaultOpen}>
            <AppSidebar platform />
            <SidebarInset className="min-w-0 bg-background">
              <TopBar platform />
              <main id="main-content" tabIndex={-1} className="flex-1 px-4 py-6 outline-none md:px-8">
                {children}
              </main>
            </SidebarInset>
          </SidebarProvider>
          <Toaster position="bottom-right" />
        </BreadcrumbProvider>
      </PlatformGuard>
    </SessionProvider>
  )
}
