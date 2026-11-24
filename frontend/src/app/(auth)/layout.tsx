import { SentraLogo, SentraWordmark } from "@/components/layout/sentra-logo"

/** Logged-out pages: no app shell, a centred card on the page background. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="mb-8 flex items-center gap-3 text-foreground">
        <SentraLogo size={36} />
        <SentraWordmark size={26} />
      </div>
      {children}
      <p className="mt-6 max-w-sm text-center text-xs text-muted-foreground">
        Sentra may only be used to test AI applications that your organization owns or is
        authorized to test.
      </p>
    </main>
  )
}
