import Image from "next/image"

import { cn } from "@/lib/utils"

/**
 * A real screenshot of the product in a frame, with its caption. The pictures come from the
 * product's own sample organization, which is fictional, and the caption says so every time, so
 * that nobody takes the figures for a customer's.
 */
export function ProductShot({
  src,
  alt,
  caption,
  width,
  height,
  priority = false,
  sizes,
  className,
}: {
  src: string
  alt: string
  caption: string
  width: number
  height: number
  priority?: boolean
  sizes: string
  className?: string
}) {
  return (
    <figure className={className}>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl ring-1 shadow-black/40 ring-white/5">
        <Image src={src} alt={alt} width={width} height={height} priority={priority} sizes={sizes} className="h-auto w-full" />
      </div>
      <figcaption className={cn("mt-3 text-sm text-muted-foreground")}>
        {caption} <span className="text-text-secondary">Sample data from a fictional organization.</span>
      </figcaption>
    </figure>
  )
}
