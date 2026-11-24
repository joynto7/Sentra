"use client"

import { useId, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, Plus, Search } from "lucide-react"

import { FAQ } from "@/components/landing/landing-content"

/**
 * The questions as numbered cards that open one at a time, with a search box that narrows them as you
 * type. The heading, the count and a way in stay at the left while the list scrolls. Each question is a
 * real button (`aria-expanded`, the answer is the region it controls), the answer opens by growing, and
 * the plus turns into a cross. With the system's "reduce motion" setting things open at once.
 */
export function FaqList() {
  const [open, setOpen] = useState<number | null>(0)
  const [query, setQuery] = useState("")
  const id = useId()

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return FAQ.map((item, index) => ({ item, index })).filter(({ item }) => !q || `${item.q} ${item.a}`.toLowerCase().includes(q))
  }, [query])

  return (
    <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
      <div data-reveal="blur" className="lg:sticky lg:top-28 lg:col-span-4 lg:self-start">
        <h2 id="faq-title" className="text-3xl leading-tight font-medium tracking-tight text-balance text-lp-ink sm:text-4xl">
          Questions
        </h2>

        <label htmlFor={`${id}-search`} className="sr-only">
          Search the questions
        </label>
        <div className="relative mt-7">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-lp-muted" aria-hidden="true" />
          <input
            id={`${id}-search`}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="h-11 w-full rounded-xl border border-lp-line bg-lp-wash pr-3 pl-10 text-[15px] text-lp-ink transition-[box-shadow,background-color,border-color] outline-none placeholder:text-lp-muted focus:border-primary/50 focus:bg-white focus:ring-3 focus:ring-primary/15"
          />
        </div>
        <p role="status" className="mt-3 text-sm text-lp-muted">
          {shown.length === FAQ.length ? `${FAQ.length} questions` : shown.length === 0 ? "No question matches." : `${shown.length} of ${FAQ.length} questions`}
        </p>

        <div className="mt-8 hidden rounded-2xl border border-lp-line bg-lp-wash p-5 lg:block">
          <p className="text-lg font-medium tracking-tight text-lp-ink">Ready to try it?</p>
          <Link
            href="/register"
            className="group mt-4 inline-flex items-center gap-2 text-[15px] font-medium text-link outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Create an account
            <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <ul className="space-y-3 lg:col-span-8">
        {shown.map(({ item, index }, position) => {
          const isOpen = open === index || shown.length === 1 // a single match opens by itself
          return (
            <li
              key={item.q}
              data-reveal={position < 8 ? "scale" : undefined}
              data-reveal-delay={100 + position * 70}
              className={`rounded-2xl border transition-[background-color,border-color,box-shadow] duration-500 motion-reduce:transition-none ${
                isOpen ? "border-primary/40 bg-lp-wash shadow-[0_22px_44px_-26px_rgba(43,79,216,0.5)]" : "border-lp-line bg-white hover:border-primary/25 hover:bg-lp-wash/60"
              }`}
            >
              <h3>
                <button
                  type="button"
                  id={`${id}-q-${index}`}
                  aria-expanded={isOpen}
                  aria-controls={`${id}-a-${index}`}
                  onClick={() => setOpen(isOpen ? null : index)}
                  className="flex w-full items-center gap-4 rounded-2xl px-5 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-6 sm:py-5"
                >
                  <span aria-hidden="true" className={`tabular w-7 shrink-0 text-sm font-medium transition-colors duration-500 motion-reduce:transition-none ${isOpen ? "text-link" : "text-lp-muted"}`}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="flex-1 text-lg font-medium tracking-tight text-lp-ink">{item.q}</span>
                  <span
                    aria-hidden="true"
                    className={`grid size-8 shrink-0 place-items-center rounded-full border transition-[transform,background-color,border-color,color] duration-500 motion-reduce:transition-none ${
                      isOpen ? "rotate-45 border-primary bg-primary text-primary-foreground" : "border-lp-line bg-white text-lp-muted"
                    }`}
                  >
                    <Plus className="size-4" />
                  </span>
                </button>
              </h3>
              {/* The answer grows from nothing to its height */}
              <div
                id={`${id}-a-${index}`}
                role="region"
                aria-labelledby={`${id}-q-${index}`}
                className={`grid transition-[grid-template-rows,opacity] duration-500 ease-out motion-reduce:transition-none ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
              >
                <div className="overflow-hidden">
                  <p className="px-5 pb-5 pl-[3.75rem] text-lg leading-relaxed text-text-secondary sm:px-6 sm:pb-6 sm:pl-[4.5rem]">{item.a}</p>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
