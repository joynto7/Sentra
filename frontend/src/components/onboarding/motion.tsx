"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Height morphing: a part that grows from nothing to its own height and folds back, for progressive
 * disclosure. It animates `grid-template-rows` between 0fr and 1fr, so it needs no measured height.
 * Closed content is hidden from the keyboard and from screen readers (`inert`). With reduced motion
 * it simply appears and disappears.
 */
export function Collapse({
  open,
  children,
  className,
}: {
  open: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "welcome-collapse grid",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className,
      )}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/** Mounts folded and opens on the next frame, so a new part grows in instead of jumping in. */
export function Reveal({
  children,
  leaving = false,
  className,
}: {
  children: React.ReactNode;
  leaving?: boolean;
  className?: string;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <Collapse open={shown && !leaving} className={className}>
      {children}
    </Collapse>
  );
}

/** Vector micro-animation: a check that draws itself (the stroke is drawn from start to end). */
export function DrawnCheck({
  size = 16,
  className,
  delay = 0.05,
}: {
  size?: number;
  className?: string;
  delay?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="welcome-draw"
        style={{ "--len": 14, "--delay": `${delay}s` } as React.CSSProperties}
      />
    </svg>
  );
}

/** The finished-state mark: a ring that draws, a check that draws after it, and one soft pulse. */
export function DoneMark() {
  return (
    <span
      className="relative mb-5 inline-flex size-16 items-center justify-center text-success"
      aria-hidden="true"
    >
      <span className="welcome-ring absolute inset-0 rounded-full border-2 border-success/40" />
      <svg
        width="64"
        height="64"
        viewBox="0 0 64 64"
        fill="none"
        className="welcome-pop"
      >
        <circle
          cx="32"
          cy="32"
          r="28"
          stroke="currentColor"
          strokeWidth="3"
          className="welcome-draw"
          style={{ "--len": 176, "--delay": "0s" } as React.CSSProperties}
        />
        <path
          d="M20 33 28.5 41.5 44 24"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="welcome-draw"
          style={{ "--len": 36, "--delay": "0.35s" } as React.CSSProperties}
        />
      </svg>
    </span>
  );
}
