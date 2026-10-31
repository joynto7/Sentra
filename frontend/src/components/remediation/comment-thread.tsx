"use client"

import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api"
import { type RemediationComment, commentOnRemediation } from "@/lib/remediation"
import { formatDateTime } from "@/lib/targets"
import { initials } from "@/lib/session"

/**
 * The thread a proposal is discussed in (UC-8.3): the developer explains what they changed, the
 * approver asks for what they need. Each message keeps the version it was written on, so the
 * thread still reads correctly once the proposal has moved on.
 */
export function CommentThread({
  code,
  version,
  comments,
  onPosted,
}: {
  code: string
  /** The version a new message is written on — the one being read. */
  version: number
  comments: RemediationComment[]
  onPosted: () => void
}) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)

  async function send() {
    if (!text.trim()) return
    setBusy(true)
    try {
      await commentOnRemediation(code, version, text.trim())
      setText("")
      onPosted()
    } catch (failed) {
      toast.error(
        failed instanceof ApiError ? failed.message : "The comment could not be sent. Try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="thread" className="rounded-[10px] border bg-card p-4">
      <h2 id="thread" className="text-[15px] font-semibold">
        Comments ({comments.length})
      </h2>
      {comments.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted-foreground">
          Nothing has been said yet. A comment is the place to explain what you changed, or what a
          proposal still needs.
        </p>
      ) : (
        <ol className="mt-3 space-y-3">
          {comments.map((one) => (
            <li key={one.id} className="flex gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
              >
                {initials(one.author ?? "?")}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px]">
                  <span className="font-medium">{one.author ?? "A former member"}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {formatDateTime(one.created_at)} · on version {one.version}
                  </span>
                </span>
                <span className="mt-0.5 block text-sm whitespace-pre-wrap">{one.text}</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-4 space-y-1.5 border-t pt-3">
        <Label htmlFor="comment">Write a comment</Label>
        <Textarea
          id="comment"
          rows={2}
          value={text}
          maxLength={2000}
          placeholder={`What should the others know about version ${version}?`}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Everybody in your organization who can read this proposal can read the thread.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={busy || !text.trim()}
            onClick={send}
          >
            {busy ? "Sending…" : "Comment"}
          </Button>
        </div>
      </div>
    </section>
  )
}
