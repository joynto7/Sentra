/**
 * The arithmetic of the radial charts of the dashboard's Breakdown (FR-7.4 (M7), UC-7.3): angles in degrees, 0 at the top, going clockwise, and a
 * wedge as an SVG path. Nothing here knows what is drawn.
 */
export function polar(radius: number, degrees: number): { x: number; y: number } {
  const radians = ((degrees - 90) * Math.PI) / 180
  return { x: radius * Math.cos(radians), y: radius * Math.sin(radians) }
}

/** A wedge between two radii and two angles (a pie slice when the inner radius is 0), with a small gap. */
export function wedge(outer: number, inner: number, start: number, end: number, gap = 1.4): string {
  // The gap between two parts is never more than a share of the part itself, so that a part of
  // a hundredth of the circle is still a sliver you can see and reach, not nothing
  const g = Math.min(gap, (end - start) * 0.4)
  const from = start + g / 2
  const to = end - g / 2
  if (to <= from) return ""
  const large = to - from <= 180 ? "0" : "1"
  const a = polar(outer, from)
  const b = polar(outer, to)
  const f = (n: number) => n.toFixed(2)
  if (inner <= 0) return `M 0 0 L ${f(a.x)} ${f(a.y)} A ${outer} ${outer} 0 ${large} 1 ${f(b.x)} ${f(b.y)} Z`
  const c = polar(inner, to)
  const d = polar(inner, from)
  return `M ${f(a.x)} ${f(a.y)} A ${outer} ${outer} 0 ${large} 1 ${f(b.x)} ${f(b.y)} L ${f(c.x)} ${f(c.y)} A ${inner} ${inner} 0 ${large} 0 ${f(d.x)} ${f(d.y)} Z`
}

/** How far a slice moves out along its own middle when it is the one in focus. */
export function bisector(start: number, end: number, distance: number): { dx: number; dy: number } {
  const mid = polar(distance, (start + end) / 2)
  return { dx: mid.x, dy: mid.y }
}

/** The slices of a whole circle (or of a half) from their counts. */
export function sweep<T extends { count: number }>(items: T[], total: number, from = 0, span = 360): (T & { start: number; end: number })[] {
  let at = from
  return items
    .filter((item) => item.count > 0)
    .map((item) => {
      const start = at
      at += (item.count / total) * span
      return { ...item, start, end: at }
    })
}
