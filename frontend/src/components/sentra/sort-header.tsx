import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"

import { TableHead } from "@/components/ui/table"
import { cn } from "@/lib/utils"

export type SortDirection = "asc" | "desc"

/**
 * A column header that sorts its table, in the pattern of the WAI-ARIA sortable table: a real
 * button inside the header, and `aria-sort` on the sorted column only, so a screen reader says
 * which column the rows follow and in which direction. The arrow shows the same to everyone else.
 */
export function SortHeader<T extends string>({
  column,
  label,
  sort,
  direction,
  onSort,
  className,
}: {
  column: T
  label: string
  sort: T
  direction: SortDirection
  onSort: (column: T) => void
  className?: string
}) {
  const active = sort === column
  const Icon = !active ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown
  return (
    <TableHead
      scope="col"
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : undefined}
      className={cn("text-xs", className)}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="-ml-1 inline-flex min-h-6 items-center gap-1 rounded-[5px] px-1 font-medium hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {label}
        <Icon className={cn("size-3.5 shrink-0", !active && "text-muted-foreground/70")} aria-hidden="true" />
      </button>
    </TableHead>
  )
}
