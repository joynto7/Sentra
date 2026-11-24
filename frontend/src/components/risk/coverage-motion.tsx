/**
 * The keyframes of the two coverage pictures. Everything that moves has the class `cm-move`, so
 * it stops with the "Pause" button (a `data-paused` ancestor) and for anyone who asked their
 * system for less motion (WCAG 2.2.2, 2.3.3).
 */
const CSS = `
@keyframes cm-sweep { to { transform: rotate(360deg) } }
@keyframes cm-pulse { 0% { transform: scale(.12); opacity: .5 } 100% { transform: scale(1); opacity: 0 } }
@keyframes cm-in { from { opacity: 0; transform: translate(-50%, -50%) scale(.2) } to { opacity: 1; transform: translate(-50%, -50%) scale(1) } }
@keyframes cm-ring { 0% { transform: scale(.92); opacity: .95 } 70% { transform: scale(1.32); opacity: 0 } 100% { transform: scale(1.32); opacity: 0 } }
@keyframes cm-breathe { 0%, 100% { filter: drop-shadow(0 0 3px var(--c)) } 50% { filter: drop-shadow(0 0 13px var(--c)) } }
@keyframes cm-dash { to { stroke-dashoffset: -28 } }
@keyframes cm-draw { from { stroke-dashoffset: var(--len) } to { stroke-dashoffset: 0 } }
@keyframes cm-scan { 0%, 100% { top: var(--from) } 50% { top: var(--to) } }
@keyframes cm-rise { from { opacity: 0; translate: 0 26px } to { opacity: 1; translate: 0 0 } }
@keyframes cm-flicker { 0%, 100% { opacity: .55 } 50% { opacity: 1 } }
/* Pausing stops what loops. What plays once (a circle arriving, a line drawn, the details rising) is left to finish, or the details would stay invisible */
[data-paused="true"] .cm-move:not(.cm-once) { animation-play-state: paused !important }
@media (prefers-reduced-motion: reduce) {
  .cm-move { animation: none !important }
}
`

export function CoverageMotion() {
  return <style>{CSS}</style>
}
