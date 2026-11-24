"use client"

import { History, Trash2 } from "lucide-react"

import { useAssistant } from "@/components/assistant/assistant-provider"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { whenText } from "@/lib/notifications"

/** The person's earlier conversations. They are private to them and deleted after 90 days. */
export function HistoryMenu() {
  const { history, conversationId, openConversation, removeConversation, refreshHistory } = useAssistant()
  return (
    <Popover onOpenChange={(open) => open && void refreshHistory()}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Earlier conversations">
          <History aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2.5">
          <p className="text-sm font-semibold">Earlier conversations</p>
          <p className="text-xs text-muted-foreground">Only you can see them. They are deleted after 90 days.</p>
        </div>
        {history.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="max-h-72 overflow-y-auto p-1">
            {history.map((item) => (
              <li key={item.id} className="group flex items-center gap-1 rounded-lg hover:bg-muted">
                <button
                  type="button"
                  onClick={() => void openConversation(item.id)}
                  aria-current={item.id === conversationId ? "true" : undefined}
                  className="min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block truncate text-sm font-medium">{item.title}</span>
                  <span className="block text-xs text-muted-foreground">{whenText(item.updated_at)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void removeConversation(item.id)}
                  aria-label={`Delete “${item.title}”`}
                  className="mr-1 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 outline-none group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
