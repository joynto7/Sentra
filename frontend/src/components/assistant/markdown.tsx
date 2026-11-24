import { Fragment, type ReactNode } from "react"
import Link from "next/link"

import { safeHref } from "@/lib/assistant"

/**
 * The little Markdown the assistant writes: paragraphs, lists, **bold**, *italic*, `code` and
 * [links](/page). It builds React elements and never sets HTML, so nothing a model writes can run.
 * A link goes to a page of the app or an https address; anything else is shown as plain text.
 */

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)/g

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const token = match[0]
    const k = `${key}-${n++}`
    if (token.startsWith("`")) {
      out.push(
        <code key={k} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      )
    } else if (token.startsWith("**")) {
      out.push(<strong key={k}>{inline(token.slice(2, -2), k)}</strong>)
    } else if (token.startsWith("[")) {
      const close = token.indexOf("](")
      const label = token.slice(1, close)
      const href = safeHref(token.slice(close + 2, -1))
      if (!href) out.push(label)
      else if (href.startsWith("/"))
        out.push(
          <Link key={k} href={href} className="font-medium text-link underline underline-offset-2">
            {label}
          </Link>,
        )
      else
        out.push(
          <a key={k} href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-link underline underline-offset-2">
            {label}
          </a>,
        )
    } else {
      out.push(<em key={k}>{token.slice(1, -1)}</em>)
    }
    last = at + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

type Block = { kind: "p"; lines: string[] } | { kind: "ul" | "ol"; items: string[] }

function blocks(text: string): Block[] {
  const out: Block[] = []
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd()
    const bullet = /^\s*(?:[-*•])\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const tail = out[out.length - 1]
    if (!line.trim()) {
      out.push({ kind: "p", lines: [] }) // a blank line ends the block
    } else if (bullet) {
      if (tail?.kind === "ul") tail.items.push(bullet[1])
      else out.push({ kind: "ul", items: [bullet[1]] })
    } else if (numbered) {
      if (tail?.kind === "ol") tail.items.push(numbered[1])
      else out.push({ kind: "ol", items: [numbered[1]] })
    } else if (tail?.kind === "p" && tail.lines.length) {
      tail.lines.push(line)
    } else if (tail?.kind === "p") {
      tail.lines.push(line)
    } else {
      out.push({ kind: "p", lines: [line] })
    }
  }
  return out.filter((b) => (b.kind === "p" ? b.lines.length : b.items.length))
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2.5 text-[0.9375rem] leading-relaxed [&_ol]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1 [&_li]:pl-0.5 [&_li::marker]:text-muted-foreground">
      {blocks(text).map((block, i) => {
        if (block.kind === "p")
          return (
            <p key={i}>
              {block.lines.map((line, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {inline(line, `${i}-${j}`)}
                </Fragment>
              ))}
            </p>
          )
        const List = block.kind === "ul" ? "ul" : "ol"
        return (
          <List key={i}>
            {block.items.map((item, j) => (
              <li key={j}>{inline(item, `${i}-${j}`)}</li>
            ))}
          </List>
        )
      })}
    </div>
  )
}
