import { SentraLogo } from "@/components/layout/sentra-logo"

/** Logged-out pages: no app shell, a centred card on the page background. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="mb-6 flex items-center gap-2.5">
        <SentraLogo size={32} />
        <span className="text-xl font-semibold tracking-tight">Sentra</span>
      </div>
      {children}
      <p className="mt-6 max-w-sm text-center text-xs text-muted-foreground">
        Sentra may only be used to test AI applications that your organization owns or is
        authorized to test.
      </p>
    </main>
  )
}
