/**
 * Two small, pure checks that keep the lab pages honest, from data the server already sends.
 *
 * `runConcerns`: a benchmark the server calls "running" is not proven to be progressing. If one of
 * its lab targets is not ready now, or it has been going far longer than its own estimate, the page
 * says so instead of showing a calm spinner.
 *
 * `benchmarkReview`: what each button of the new-run page will do, and what is still missing before
 * either can be pressed, in the words of the form.
 */

export type RunInfo = { status: string; started_at: string | null; ended_at: string | null; estimate_minutes: number; lab_targets: string[] }
export type LabCardInfo = { name: string; state: string }

const hours = (minutes: number) => (minutes >= 120 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes)} min`)

export function runConcerns(run: RunInfo, cards: LabCardInfo[] | null, now: number): string[] {
  if (run.status !== "running") return []
  const out: string[] = []
  if (cards) {
    const down = run.lab_targets.filter((name) => {
      const card = cards.find((one) => one.name === name)
      // "resetting" and "deploying" are normal between and before runs; anything else is not running a target
      return !card || !["ready", "resetting", "deploying"].includes(card.state)
    })
    if (down.length) out.push(`${down.join(", ")} ${down.length === 1 ? "is" : "are"} not ready now, so this run cannot be making progress. Open the Security Lab to see why.`)
  }
  if (run.started_at && run.estimate_minutes > 0) {
    const minutes = (now - Date.parse(run.started_at)) / 60000
    if (minutes > Math.max(run.estimate_minutes * 3, 60)) out.push(`It has been running for ${hours(minutes)}, far longer than its estimate of about ${hours(run.estimate_minutes)}. Check the lab and the workers before waiting longer.`)
  }
  return out
}

export type ReviewInput = {
  readyTargets: string[]
  chosenTargets: string[]
  strategies: { key: string; name: string; suites: number; adaptive: boolean }[]
  budget: number
  repetitions: number
  judgeEvery: boolean
  estimate: { runs: number; minutes: number; attempts: number; cost: string } | null
}

export function benchmarkReview(i: ReviewInput): { missing: string[]; lines: string[] } {
  const missing: string[] = []
  if (i.readyTargets.length === 0) missing.push("No lab target is ready, so nothing can be chosen. Deploy one in the Security Lab first.")
  else if (i.chosenTargets.length === 0) missing.push("Choose at least one lab target.")
  if (i.strategies.length < 2) missing.push("Keep at least two strategies, so there is something to compare.")
  for (const s of i.strategies) if (s.suites === 0) missing.push(`${s.name || `Strategy ${s.key}`} has no test suite.`)
  const lines = [
    `Compares ${i.strategies.map((s) => s.name || `Strategy ${s.key}`).join(" and ")} on ${i.chosenTargets.length ? i.chosenTargets.join(", ") : "no lab target yet"}, ${i.repetitions} repetitions each, at most ${i.budget} attempts per campaign run, ${i.judgeEvery ? "with the LLM judge on every attempt" : "without the LLM judge on every attempt"}.`,
    "Save draft keeps this configuration and runs nothing.",
    "Save and start begins the first campaign run at once against the lab; every run starts from a freshly reset lab target, and the configuration is fixed from then on.",
  ]
  if (i.estimate) lines.push(`Estimate, not a measurement: ${i.estimate.runs} campaign runs, about ${i.estimate.attempts.toLocaleString("en-GB")} attempts, ${i.estimate.cost}.`)
  return { missing, lines }
}
