import { cookies } from "next/headers"

import { AssistantProvider } from "@/components/assistant/assistant-provider"
import { AssistantPanel } from "@/components/assistant/assistant-panel"
import { AssistantFab } from "@/components/assistant/assistant-launcher"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { BreadcrumbProvider } from "@/components/layout/breadcrumbs"
import { SkipLink } from "@/components/layout/skip-link"
import { SessionProvider } from "@/components/session-provider"
import { TopBar } from "@/components/layout/top-bar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false"

  return (
    <SessionProvider>
      <AssistantProvider>
        <BreadcrumbProvider>
          <SkipLink />
          <SidebarProvider defaultOpen={defaultOpen}>
            <AppSidebar />
            <SidebarInset className="min-w-0 bg-background">
              <TopBar />
              <main id="main-content" tabIndex={-1} className="flex-1 px-4 py-6 outline-none md:px-8">
                {children}
              </main>
            </SidebarInset>
          </SidebarProvider>
          <AssistantPanel />
          <AssistantFab />
          <Toaster position="bottom-right" offset={{ bottom: 88, right: 24 }} />
        </BreadcrumbProvider>
      </AssistantProvider>
    </SessionProvider>
  )
}
