import { cn } from "@/lib/utils"

/** The centred white card used by every logged-out page. */
export function AuthCard({
  title,
  description,
  wide = false,
  children,
}: {
  title: string
  description?: React.ReactNode
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "w-full rounded-[10px] border bg-card p-8",
        wide ? "max-w-[440px]" : "max-w-[400px]",
      )}
    >
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-6">{children}</div>
    </div>
  )
}
