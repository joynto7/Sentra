"use client"

import { useMemo } from "react"

import { PathMap } from "@/components/risk/path-map"
import { usePathWalk } from "@/components/risk/use-path-walk"
import type { Severity } from "@/components/sentra/severity-badge"
import type { AttackPath, PathEdge, PathFinding, PathNode, PathStep } from "@/lib/risk"
import { type ComponentKind, KIND_LABEL, type ThreatComponent } from "@/lib/threat-models"

/** The threats the map counts: the ones of the version on the page, with unsaved changes applied. */
type MapThreat = {
  key: string
  number: number | null
  title: string
  component_kind: string
  component_name: string
  likelihood: number
  impact: number
  removed: boolean
}

const INPUT = "input"
const INPUT_NAME = "User input"
const key = (kind: string, name: string) => `${kind}::${name}`
const kindName = (kind: string) => KIND_LABEL[kind as ComponentKind] ?? kind

/** Where each kind of component sits in the application's pipeline, as in the attack path map. */
const STAGE: Record<string, number> = { input: 0, knowledge_source: 1, system_prompt: 2, model: 3, tool: 4, output: 5 }

/** The connections of the pipeline: a request reaches the model, which calls tools and answers. */
const EDGES: [string, string, string][] = [
  [INPUT, "model", "Every request to the target reaches the model."],
  ["knowledge_source", "model", "The model retrieves from this knowledge source."],
  ["system_prompt", "model", "The system prompt tells the model how to behave."],
  ["model", "tool", "The model can call this tool."],
  ["model", "output", "The model's answer leaves the application through this channel."],
]

/** Risk is likelihood times impact, 1 to 25. The map reads it in the severity words of the findings. */
function severityOf(risk: number): Severity {
  if (risk >= 20) return "critical"
  if (risk >= 15) return "high"
  if (risk >= 8) return "medium"
  return "low"
}

const codeOf = (threat: MapThreat) => (threat.number !== null ? `T-${threat.number}` : `New threat (${threat.key})`)

/**
 * The map of one threat model: the application's components in the columns of its pipeline, a
 * badge on each with the number of threats on it, and arrows that flow along the route with the
 * highest risk, from what an attacker reaches first to what it can do in the end. It is drawn
 * from the same components and threats as the lists beside it, so an edit, a removal or an added
 * threat changes it at once, and choosing a component filters the threats list.
 */
export function ThreatMap({
  targetName,
  components,
  threats,
  onPick,
}: {
  targetName: string
  components: ThreatComponent[]
  threats: MapThreat[]
  /** The key of the chosen component (kind and name), or null when none is chosen. */
  onPick: (component: string | null) => void
}) {
  const model = useMemo(() => {
    const active = threats.filter((threat) => !threat.removed)
    const risk = (threat: MapThreat) => threat.likelihood * threat.impact
    const on = (kind: string, name: string) => active.filter((t) => t.component_kind === kind && t.component_name === name)

    const nodes: PathNode[] = [
      {
        id: key(INPUT, INPUT_NAME),
        kind: INPUT,
        name: INPUT_NAME,
        label: `Input channel: ${INPUT_NAME}`,
        stage: STAGE.input,
        note: "Every request to the target arrives here.",
        in_profile: true,
        entry: true,
        impact: "",
        findings: [],
      },
      ...components.map((component): PathNode => {
        const here = on(component.kind, component.name)
        return {
          id: key(component.kind, component.name),
          kind: component.kind,
          name: component.name,
          label: `${KIND_LABEL[component.kind]}: ${component.name}`,
          stage: STAGE[component.kind],
          note: component.note,
          in_profile: true,
          entry: STAGE[component.kind] <= 1,
          impact: "",
          findings: here.map(codeOf),
        }
      }),
    ]

    const findings: PathFinding[] = active.map((threat) => {
      const node = key(threat.component_kind, threat.component_name)
      return {
        code: codeOf(threat),
        title: `${threat.title} (risk ${risk(threat)})`,
        severity: severityOf(risk(threat)),
        status: "confirmed",
        category: "",
        unconfirmed: false,
        last_seen_at: "",
        node_id: node,
        component: {
          kind: threat.component_kind,
          name: threat.component_name,
          label: `${kindName(threat.component_kind)}: ${threat.component_name}`,
        },
        in_profile: true,
      }
    })

    const ids = new Set(nodes.map((node) => node.id))
    const edges: PathEdge[] = []
    for (const [from, to, why] of EDGES) {
      for (const a of nodes.filter((node) => node.kind === from)) {
        for (const b of nodes.filter((node) => node.kind === to)) edges.push({ from: a.id, to: b.id, why })
      }
    }

    // The route: the riskiest threat on what comes from outside, then the model, then the
    // riskiest threat on what the model does or says. Whatever side has no threat is skipped.
    const worst = (nodeIds: string[]) =>
      nodeIds
        .map((id) => ({ id, top: [...active].filter((t) => key(t.component_kind, t.component_name) === id).sort((a, b) => risk(b) - risk(a))[0] }))
        .filter((one) => one.top)
        .sort((a, b) => risk(b.top) - risk(a.top))[0]
    const entry = worst(nodes.filter((node) => node.kind === "knowledge_source" || node.kind === "system_prompt").map((node) => node.id))
    const exit = worst(nodes.filter((node) => node.kind === "tool" || node.kind === "output").map((node) => node.id))
    const modelNode = nodes.find((node) => node.kind === "model")
    const chain = [entry?.id ?? key(INPUT, INPUT_NAME), modelNode?.id, exit?.id].filter((id): id is string => Boolean(id) && ids.has(id as string))
    const touched = chain.filter((id) => active.some((t) => key(t.component_kind, t.component_name) === id))

    let route: AttackPath | null = null
    if (active.length > 0 && chain.length > 1 && touched.length > 0) {
      const steps: PathStep[] = chain.map((id, index) => {
        const node = nodes.find((one) => one.id === id)!
        const here = findings.filter((finding) => finding.node_id === id)
        const topRisk = Math.max(0, ...active.filter((t) => key(t.component_kind, t.component_name) === id).map(risk))
        return {
          number: index + 1,
          sentence: here.length
            ? `${here.length} ${here.length === 1 ? "threat" : "threats"} on it, the highest rated ${topRisk} of 25.`
            : node.note || "No threat of this model sits here, but the route passes through it.",
          component: { kind: node.kind, name: node.name, label: node.label },
          findings: here,
        }
      })
      const top = Math.max(...active.map(risk))
      route = {
        key: "top-risk",
        code: "Highest-risk route",
        severity: severityOf(top),
        impact: (exit ?? entry)?.top.title ?? "",
        description: "",
        has_unconfirmed: false,
        node_ids: chain,
        finding_codes: findings.map((finding) => finding.code),
        steps,
      }
    }
    return { nodes, edges, findings, route, total: active.length }
  }, [components, threats])

  const walk = usePathWalk(model.route?.key ?? null, model.route?.steps.length ?? 0)

  return (
    <section aria-label="Threat map" className="min-w-0 space-y-2">
      <PathMap
        targetName={targetName}
        title="Threat map"
        noun="threat"
        itemHref={() => null}
        onPick={(id) => onPick(id && !id.startsWith(`${INPUT}::`) ? id : null)}
        nodes={model.nodes}
        edges={model.edges}
        findings={model.findings}
        selected={model.route}
        step={walk.step}
        playing={walk.playing}
        onStep={walk.go}
        onToggle={walk.toggle}
        onReset={walk.reset}
      />
      <p className="text-xs text-muted-foreground">
        {model.route
          ? "The arrows follow the route with the highest-risk threats, from what an attacker reaches first to what it can do. Play the walkthrough to step along it; choose a component to list only its threats."
          : model.total === 0
            ? "This threat model has no threat yet, so no route is drawn."
            : "No threat sits on a route from the input to an action or an answer, so no route is drawn."}{" "}
        The number on a circle is the threats on that component.
      </p>
    </section>
  )
}
