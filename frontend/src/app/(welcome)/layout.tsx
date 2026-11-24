import { SessionProvider } from "@/components/session-provider"
import { Toaster } from "@/components/ui/sonner"

/** The first-run setup: logged in, full screen, no sidebar and no header of the app. */
export default function WelcomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider requireOrganization={false}>
      {children}
      <Toaster position="bottom-right" />
    </SessionProvider>
  )
}
