import { cookies } from "next/headers"

import { AppSidebar } from "@/components/layout/app-sidebar"
import { BreadcrumbProvider } from "@/components/layout/breadcrumbs"
import { SessionProvider } from "@/components/session-provider"
import { TopBar } from "@/components/layout/top-bar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false"

  return (
    <SessionProvider>
      <BreadcrumbProvider>
        <SidebarProvider defaultOpen={defaultOpen}>
          <AppSidebar />
          <SidebarInset className="min-w-0 bg-background">
            <TopBar />
            <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
          </SidebarInset>
        </SidebarProvider>
        <Toaster position="bottom-right" />
      </BreadcrumbProvider>
    </SessionProvider>
  )
}
