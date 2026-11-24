import { CalendarClock, MoreHorizontal, Pencil, Play, Trash2, TriangleAlert } from "lucide-react"

import { TypeMark, scopeText } from "@/components/reports/report-parts"
import { atWithZone } from "@/components/reports/report-plan"
import { GLASS_BUTTON, GLASS_ROUND, GlassCard } from "@/components/sentra/glass-card"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import { FREQUENCY_LABEL, type Schedule, TYPE_LABEL } from "@/lib/reports"
import { initials } from "@/lib/session"

/**
 * A schedule as a card: what it produces and how often, who gets it, when the next one is due, and
 * the three things done with it: switch it on or off, run it now, edit or delete it.
 */
export function ScheduleCard({
  schedule,
  readAt,
  canManage,
  busy,
  onToggle,
  onRun,
  onEdit,
  onDelete,
}: {
  schedule: Schedule
  readAt: number
  canManage: boolean | undefined
  busy: boolean
  onToggle: () => void
  onRun: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const paused = schedule.status === "paused"
  const due = schedule.next_run_at ? new Date(schedule.next_run_at) : null
  const overdue = !paused && due !== null && due.getTime() < readAt - 5 * 60_000
  const shown = schedule.recipients.slice(0, 4)
  return (
    <GlassCard label={`${schedule.name}, ${paused ? "paused" : "active"}`}>
      <div className="flex items-center gap-3">
        <TypeMark type={schedule.type} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-lg leading-6 font-medium">{schedule.name}</p>
          <p className="truncate text-sm text-foreground/65">
            {TYPE_LABEL[schedule.type]} · {schedule.format.toUpperCase()} · {scopeText(schedule)}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-white/70 px-3 py-2 dark:bg-white/5">
        <span className="flex items-center gap-2 text-sm">
          <CalendarClock className="size-4 text-foreground/65" aria-hidden="true" />
          {FREQUENCY_LABEL[schedule.frequency]}
        </span>
        {canManage ? (
          <label className="flex items-center gap-2 text-xs text-foreground/70">
            {paused ? "Paused" : "Active"}
            <Switch checked={!paused} disabled={busy} onCheckedChange={onToggle} aria-label={`${schedule.name} is ${paused ? "paused" : "active"}`} />
          </label>
        ) : (
          <span className="text-xs text-foreground/70">{paused ? "Paused" : "Active"}</span>
        )}
      </div>

      <div className="mt-3 text-sm">
        <p className="text-xs text-foreground/60">Next report</p>
        {paused ? (
          <p className="text-foreground/70">Paused</p>
        ) : overdue && due ? (
          <p className="flex items-start gap-1.5 text-warning">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-medium">Overdue.</span> Was due {atWithZone(due)}.
            </span>
          </p>
        ) : due ? (
          <p>{atWithZone(due)}</p>
        ) : (
          <p>After the next campaign run</p>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        {shown.length > 0 ? (
          <>
            <span className="flex -space-x-2" aria-hidden="true">
              {shown.map((one) => (
                <span
                  key={one.name}
                  title={one.name}
                  className="grid size-7 place-items-center rounded-full border-2 border-white bg-[#c9d2fa] text-[10px] font-semibold text-[#1f2f80] dark:border-[#151b30] dark:bg-[#27406f] dark:text-[#d8e4ff]"
                >
                  {initials(one.name)}
                </span>
              ))}
            </span>
            <span className="truncate text-xs text-foreground/65">
              {schedule.recipients.map((one) => one.name).join(", ")}
            </span>
          </>
        ) : (
          <span className="text-xs text-foreground/65">No recipients</span>
        )}
      </div>

      {canManage && (
        <div className="mt-auto flex items-center gap-2 pt-4">
          <button type="button" className={GLASS_BUTTON} disabled={busy} onClick={onRun} aria-label={`Run ${schedule.name} now`}>
            <Play className="mr-2 size-4" aria-hidden="true" />
            Run now
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className={GLASS_ROUND} aria-label={`More for ${schedule.name}`}>
                <MoreHorizontal className="size-5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil aria-hidden="true" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 aria-hidden="true" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </GlassCard>
  )
}
