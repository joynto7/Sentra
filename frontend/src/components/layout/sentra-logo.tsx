import { cn } from "@/lib/utils"

/*
 * Sentra brand. The name is set in wide Geist capitals with the A drawn as a Λ (no crossbar) and a
 * point inside it: the weak spot Sentra finds. The colours are the UI's own: the point is the
 * primary cobalt (#2B4FD8, or #6C8CFF on dark). The app icon stays the cobalt shield-and-check
 * tile. Keep the icon's shapes in step with `app/icon.svg`.
 */

/** The Λ with its point, drawn in a 20 x 20 box. */
const LAMBDA = "M2 19 10 1.5 18 19"

/** App icon: cobalt rounded square with a white shield-and-check outline. Used where there is no
 * room for the name (the collapsed sidebar, the audit log's "Sentra" actor) and as the favicon. */
export function SentraLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" className="shrink-0">
      <rect width="28" height="28" rx="7" fill="#2B4FD8" />
      <path
        d="M14 6.5 20 8.8v4.6c0 3.9-2.5 6.9-6 8.1-3.5-1.2-6-4.2-6-8.1V8.8l6-2.3Z"
        fill="none"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="m11.2 14 2 2 3.8-4"
        fill="none"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The wordmark SENTRΛ. It takes the text colour of where it sits; the point is the primary colour,
 * or with `onDark` the light cobalt that keeps 6:1 on the navy sidebar. Screen readers hear "Sentra".
 */
export function SentraWordmark({
  size = 18,
  onDark = false,
  className,
}: {
  size?: number
  onDark?: boolean
  className?: string
}) {
  return (
    <span
      role="img"
      aria-label="Sentra"
      className={cn("inline-flex items-center font-semibold leading-none", className)}
      style={{ fontSize: size, letterSpacing: "0.16em" }}
    >
      <span aria-hidden="true">SENTR</span>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        style={{ width: "0.74em", height: "0.8em", marginTop: "-0.08em", marginLeft: "-0.01em", overflow: "visible" }}
      >
        <path
          d={LAMBDA}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="10" cy="15" r="2.2" style={{ fill: onDark ? "#6C8CFF" : "var(--primary)" }} />
      </svg>
    </span>
  )
}
