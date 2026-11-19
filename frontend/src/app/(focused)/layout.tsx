import { FocusedHeader } from "@/components/layout/focused-header"
import { SessionProvider } from "@/components/session-provider"

/** Focused pages: logged in, but no sidebar (for example creating the first organization). */
export default function FocusedLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider requireOrganization={false}>
      <div className="min-h-screen bg-background">
        <FocusedHeader />
        <main className="flex flex-col items-center px-4 py-16">{children}</main>
      </div>
    </SessionProvider>
  )
}
