/** Empty state: a heading, one sentence and at most one action. */
export function EmptyState({
  title,
  description,
  action,
  page = false,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  /** The state is the whole page (no page header above it): its title is then the page's heading */
  page?: boolean
}) {
  const Heading = page ? "h1" : "h2"
  return (
    <div className="flex flex-col items-center justify-center rounded-[10px] border bg-card px-6 py-16 text-center">
      <Heading className="text-[15px] font-semibold">{title}</Heading>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
