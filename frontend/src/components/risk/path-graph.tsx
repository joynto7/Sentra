import { useId } from "react"

import type { AttackPath, PathEdge, PathFinding, PathNode } from "@/lib/risk"

const COLUMN = 184
const NODE = 156
const HEAD = 32
const ROW = 18
const GAP = 14
const TOP = 10
const SEVERITY_COLOUR: Record<string, string> = {
  critical: "var(--severity-critical)",
  high: "var(--severity-high)",
  medium: "var(--severity-medium)",
  low: "var(--severity-low)",
  informational: "var(--severity-info)",
}

type Box = { node: PathNode; x: number; y: number; height: number }

function shorten(text: string, length = 22) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}

/** Where each component is drawn: one column per stage of the pipeline, in the API's own order. */
function layout(nodes: PathNode[]): Box[] {
  const stages = [...new Set(nodes.map((node) => node.stage))].sort((a, b) => a - b)
  const boxes: Box[] = []
  for (const [column, stage] of stages.entries()) {
    let y = TOP
    for (const node of nodes.filter((one) => one.stage === stage)) {
      const height = HEAD + node.findings.length * ROW + (node.findings.length ? 8 : 0)
      boxes.push({ node, x: column * COLUMN + 8, y, height })
      y += height + GAP
    }
  }
  return boxes
}

/**
 * The target's components and the findings on them (UC-7.5 steps 2-3), drawn as the pipeline the
 * Target Profile describes: one column per stage, connectors for the connections the API returns.
 * The drawing is a picture of what the panel and the list already say in words, so it carries
 * `role="img"` and nothing here has to be dragged, zoomed or reached with a keyboard (NFR-4.3).
 */
export function PathGraph({
  nodes,
  edges,
  findings,
  selected,
}: {
  nodes: PathNode[]
  edges: PathEdge[]
  findings: PathFinding[]
  /** The path whose steps are drawn thicker; the other components fade. */
  selected: AttackPath | null
}) {
  const titleId = useId()
  const boxes = layout(nodes)
  const at = new Map(boxes.map((box) => [box.node.id, box]))
  const byCode = new Map(findings.map((finding) => [finding.code, finding]))
  const width = Math.max(...boxes.map((box) => box.x + NODE + 8), COLUMN)
  const height = Math.max(...boxes.map((box) => box.y + box.height + TOP), 120)
  const onPath = (id: string) => !selected || selected.node_ids.includes(id)
  const step = (id: string) => (selected ? selected.node_ids.indexOf(id) : -1)

  return (
    // Drawn at its own size, so the components stay readable; the card around it scrolls when the
    // window is narrower than the pipeline (UC-7.5: nothing here is dragged).
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="max-w-none"
      role="img"
      aria-labelledby={titleId}
    >
      <title id={titleId}>
        {`The target's components from its Target Profile, left to right: ${boxes
          .map((box) => box.node.label + (box.node.findings.length ? ` with ${box.node.findings.join(", ")}` : ""))
          .join("; ")}.`}
      </title>
      {edges.map((edge) => {
        const from = at.get(edge.from)
        const to = at.get(edge.to)
        if (!from || !to || from.x >= to.x) return null
        const x1 = from.x + NODE
        const y1 = from.y + from.height / 2
        const x2 = to.x
        const y2 = to.y + to.height / 2
        const bright = selected !== null && step(edge.from) >= 0 && step(edge.to) === step(edge.from) + 1
        return (
          <path
            key={`${edge.from}->${edge.to}`}
            d={`M ${x1} ${y1} C ${x1 + 26} ${y1}, ${x2 - 26} ${y2}, ${x2} ${y2}`}
            fill="none"
            stroke={bright ? "var(--primary)" : "var(--border-strong, var(--border))"}
            strokeWidth={bright ? 2 : 1}
            opacity={onPath(edge.from) && onPath(edge.to) ? 1 : 0.3}
          />
        )
      })}
      {boxes.map((box) => {
        const faded = !onPath(box.node.id)
        const position = step(box.node.id)
        return (
          <g key={box.node.id} opacity={faded ? 0.35 : 1}>
            <rect
              x={box.x}
              y={box.y}
              width={NODE}
              height={box.height}
              rx={7}
              fill="var(--card)"
              stroke={position >= 0 ? "var(--primary)" : "var(--border)"}
              strokeWidth={position >= 0 ? 2 : 1}
              strokeDasharray={box.node.in_profile ? undefined : "4 3"}
            />
            {position >= 0 && (
              <circle cx={box.x + NODE - 11} cy={box.y + 11} r={8} fill="var(--primary)" opacity={0.9} />
            )}
            {position >= 0 && (
              <text
                x={box.x + NODE - 11}
                y={box.y + 14.5}
                textAnchor="middle"
                className="fill-primary-foreground text-[9px] font-semibold"
              >
                {position + 1}
              </text>
            )}
            <text x={box.x + 10} y={box.y + 14} className="fill-muted-foreground text-[9px] uppercase">
              {box.node.kind.replace(/_/g, " ")}
            </text>
            <text x={box.x + 10} y={box.y + 25} className="fill-foreground text-[12px] font-medium">
              {shorten(box.node.name)}
            </text>
            {box.node.findings.map((code, index) => {
              const finding = byCode.get(code)
              const y = box.y + HEAD + index * ROW + 4
              return (
                <g key={code}>
                  <rect
                    x={box.x + 10}
                    y={y - 10}
                    width={NODE - 20}
                    height={15}
                    rx={3}
                    fill="var(--muted)"
                    stroke={finding?.unconfirmed ? "var(--warning)" : "none"}
                    strokeDasharray={finding?.unconfirmed ? "3 2" : undefined}
                  />
                  <circle
                    cx={box.x + 17}
                    cy={y - 2}
                    r={3}
                    fill={SEVERITY_COLOUR[finding?.severity ?? "low"]}
                  />
                  <text x={box.x + 24} y={y + 1} className="fill-foreground text-[10px]">
                    {code}
                    {finding?.unconfirmed ? " · unconfirmed" : ""}
                  </text>
                </g>
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}
