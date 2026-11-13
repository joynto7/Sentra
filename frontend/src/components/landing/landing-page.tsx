import Link from "next/link"
import {
  ArrowRight,
  Check,
  Fingerprint,
  Gauge,
  Lock,
  Radar,
  Route,
  ScrollText,
  Server,
  ShieldCheck,
  UserCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react"

import {
  CAPABILITIES,
  FAQ,
  NAV,
  PHASES,
  SAFETY,
  STEPS,
  USE_CASES,
} from "@/components/landing/landing-content"
import { ProductShot } from "@/components/landing/product-shot"
import { SiteHeader } from "@/components/landing/site-header"
import { SentraLogo } from "@/components/layout/sentra-logo"
import { Button } from "@/components/ui/button"

const CAPABILITY_ICON: Record<string, LucideIcon> = {
  evidence: Fingerprint,
  "attack-paths": Route,
  limits: Radar,
  fix: Wrench,
}
const SAFETY_ICON: LucideIcon[] = [Fingerprint, Gauge, UserCheck, ScrollText, Lock, Server]

const CONTAINER = "mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8"
const KICKER = "text-sm font-medium tracking-wide text-link"
// The washes of blue between the white sections, and the glow behind the hero
const BAND = "bg-[linear-gradient(180deg,#f2f6ff_0%,#ffffff_100%)]"
const GLOW =
  "bg-[radial-gradient(52rem_30rem_at_82%_-4rem,rgba(91,124,255,0.34),transparent),radial-gradient(38rem_26rem_at_4%_8%,rgba(147,197,253,0.5),transparent),linear-gradient(180deg,#eaf1ff_0%,#ffffff_78%)]"
const H2 = "text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl"

/**
 * The public page of Sentra, for people who have not logged in. White, with a radiant blue from the
 * product's own cobalt (the hero's glow, the washes between sections and the closing panel), and every button and
 * link goes somewhere real: the registration page, the log in page, a place on this page, or the
 * source. There is no form: Sentra has no demo or contact service, so none is pretended.
 */
export function LandingPage() {
  return (
    <div className="landing-light min-h-screen overflow-x-clip bg-white text-[#0b1330]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <SiteHeader />

      <main id="main-content">
        {/* Hero */}
        <section aria-labelledby="hero-title" className="relative overflow-hidden border-b border-border/60">
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 ${GLOW}`}
          />
          <div className={`${CONTAINER} relative grid items-center gap-12 py-16 sm:py-20 lg:grid-cols-12 lg:gap-10 lg:py-24`}>
            <div className="lg:col-span-5">
              <p className={KICKER}>AI security testing platform</p>
              <h1
                id="hero-title"
                className="mt-4 text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl lg:text-[3.1rem]"
              >
                Find, prove and fix{" "}
                <span className="bg-gradient-to-r from-[#1d3fc4] to-[#2f6df6] bg-clip-text text-transparent">
                  the weaknesses in your AI applications.
                </span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-text-secondary">
                Sentra tests the chatbots, RAG systems and tool-using agents that you own or are allowed to test.
                Every finding has its evidence behind it, every fix is approved by a person, and every fix is tested again.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild className="h-11 bg-gradient-to-b from-[#3b5cf0] to-[#2443c4] px-5 text-base shadow-[0_10px_30px_-10px_rgba(43,79,216,0.7)] hover:from-[#2f50e0] hover:to-[#1d3fc4]">
                  <Link href="/register">
                    Create an account
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="h-11 border-[#c9d6ff] bg-white px-5 text-base hover:bg-[#eef3ff]">
                  <a href="#how-it-works">See how it works</a>
                </Button>
              </div>
              <p className="mt-6 max-w-md text-sm leading-relaxed text-muted-foreground">
                Built-in tests are mapped to the OWASP Top 10 for LLM Applications and to MITRE ATLAS. Nothing runs
                against an application until you have proved that it is yours.
              </p>
            </div>

            <ProductShot
              className="lg:col-span-7"
              src="/landing/dashboard.jpg"
              alt="The Sentra Risk Dashboard: a list of what needs attention, counts of open, untriaged and fixed findings, and a risk score for each target."
              caption="The Risk Dashboard: what needs attention, and the risk score of each target."
              width={2880}
              height={1800}
              priority
              sizes="(min-width: 1280px) 760px, (min-width: 1024px) 58vw, 100vw"
            />
          </div>
        </section>

        {/* The problem and the approach */}
        <section id="platform" aria-labelledby="platform-title" className="scroll-mt-20">
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <div className="grid gap-10 lg:grid-cols-12">
              <div className="lg:col-span-6">
                <p className={KICKER}>The problem</p>
                <h2 id="platform-title" className={`${H2} mt-3`}>
                  AI applications fail in ways ordinary testing never looks for.
                </h2>
              </div>
              <div className="space-y-4 text-lg leading-relaxed text-text-secondary lg:col-span-6">
                <p>
                  A chatbot can be talked out of its instructions. A retrieval system can return a document the question
                  never asked for. An agent can call a tool it should not. Prompt injection, leaked system prompts and
                  confidential documents, and the misuse of tools are not found by a scan of the code.
                </p>
                <p>
                  Sentra covers the whole path in one place, from the first request to the fix that has been checked.
                </p>
              </div>
            </div>

            <ol className="mt-14 grid gap-px overflow-hidden rounded-xl border border-[#d4defc] bg-[#d4defc] shadow-[0_20px_60px_-30px_rgba(43,79,216,0.35)] md:grid-cols-3">
              {PHASES.map((phase, index) => (
                <li key={phase.name} className="bg-white p-6 sm:p-8">
                  <p className="font-mono text-sm text-muted-foreground">0{index + 1}</p>
                  <h3 className="mt-2 text-xl font-semibold tracking-tight">{phase.name}</h3>
                  <ul className="mt-5 space-y-3">
                    {phase.steps.map((step) => (
                      <li key={step} className="flex gap-3 text-[15px] leading-snug text-text-secondary">
                        <Check className="mt-0.5 size-4 shrink-0 text-link" aria-hidden="true" />
                        {step}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Capabilities */}
        <section aria-labelledby="capabilities-title" className={`border-y border-border/60 ${BAND}`}>
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <p className={KICKER}>What it does</p>
            <h2 id="capabilities-title" className={`${H2} mt-3 max-w-3xl`}>
              Four things that make a security finding something you can act on.
            </h2>

            <div className="mt-6 divide-y divide-border/60">
              {CAPABILITIES.map((capability, index) => {
                const Icon = CAPABILITY_ICON[capability.id]
                const reversed = index % 2 === 1
                return (
                  <article key={capability.id} className="grid items-center gap-10 py-14 lg:grid-cols-12 lg:gap-14 lg:py-20">
                    <div className={`lg:col-span-5 ${reversed ? "lg:order-2" : ""}`}>
                      <p className="inline-flex items-center gap-2 text-sm font-medium text-link">
                        <span className="grid size-8 place-items-center rounded-md border border-[#c9d6ff] bg-[#eef3ff]">
                          <Icon className="size-4" aria-hidden="true" />
                        </span>
                        {capability.kicker}
                      </p>
                      <h3 className="mt-4 text-2xl leading-snug font-semibold tracking-tight text-balance sm:text-3xl">
                        {capability.title}
                      </h3>
                      <p className="mt-4 leading-relaxed text-text-secondary">{capability.problem}</p>
                      <ul className="mt-6 space-y-3">
                        {capability.points.map((point) => (
                          <li key={point} className="flex gap-3 text-[15px] leading-relaxed text-foreground/90">
                            <Check className="mt-1 size-4 shrink-0 text-link" aria-hidden="true" />
                            {point}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <ProductShot
                      className={`lg:col-span-7 ${reversed ? "lg:order-1" : ""}`}
                      src={capability.image}
                      alt={capability.alt}
                      caption={capability.caption}
                      width={2400}
                      height={1688}
                      sizes="(min-width: 1280px) 720px, (min-width: 1024px) 58vw, 100vw"
                    />
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20">
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <p className={KICKER}>How it works</p>
            <h2 id="how-title" className={`${H2} mt-3 max-w-3xl`}>
              From a registered application to a verified fix, in four steps.
            </h2>
            <ol className="mt-12 grid gap-10 md:grid-cols-2 xl:grid-cols-4 xl:gap-8">
              {STEPS.map((step, index) => (
                <li key={step.title} className="relative border-t border-border pt-6">
                  <span className="absolute -top-px left-0 h-px w-12 bg-primary" aria-hidden="true" />
                  <p className="font-mono text-sm text-muted-foreground">Step {index + 1}</p>
                  <h3 className="mt-2 text-xl font-semibold tracking-tight">{step.title}</h3>
                  <dl className="mt-5 space-y-4 text-[15px] leading-relaxed">
                    {[
                      ["You start with", step.input],
                      ["You do", step.action],
                      ["You get", step.outcome],
                    ].map(([label, text]) => (
                      <div key={label}>
                        <dt className="text-xs font-medium tracking-wider text-muted-foreground uppercase">{label}</dt>
                        <dd className="mt-1 text-text-secondary">{text}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Use cases */}
        <section id="use-cases" aria-labelledby="use-title" className={`scroll-mt-20 border-y border-border/60 ${BAND}`}>
          <div className={`${CONTAINER} grid gap-12 py-20 lg:grid-cols-12 lg:py-28`}>
            <div className="lg:col-span-4">
              <p className={KICKER}>Use cases</p>
              <h2 id="use-title" className={`${H2} mt-3`}>
                Made for the people who answer for an AI application.
              </h2>
            </div>
            <ul className="divide-y divide-border/60 border-y border-border/60 lg:col-span-8">
              {USE_CASES.map((useCase) => (
                <li key={useCase.title} className="grid gap-2 py-7 sm:grid-cols-[13rem_1fr] sm:gap-8">
                  <p className="text-sm font-medium text-link">{useCase.role}</p>
                  <div>
                    <h3 className="text-xl font-semibold tracking-tight">{useCase.title}</h3>
                    <p className="mt-2 leading-relaxed text-text-secondary">{useCase.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Safe by design */}
        <section aria-labelledby="safety-title">
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <p className={KICKER}>Safe by design</p>
            <h2 id="safety-title" className={`${H2} mt-3 max-w-3xl`}>
              A tool that attacks your applications has to be careful with them.
            </h2>
            <ul className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {SAFETY.map((item, index) => {
                const Icon = SAFETY_ICON[index] ?? ShieldCheck
                return (
                  <li key={item.title}>
                    <span className="grid size-10 place-items-center rounded-lg border border-[#c9d6ff] bg-[#eef3ff]">
                      <Icon className="size-5 text-link" aria-hidden="true" />
                    </span>
                    <h3 className="mt-4 text-lg font-semibold tracking-tight">{item.title}</h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-text-secondary">{item.text}</p>
                  </li>
                )
              })}
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" aria-labelledby="faq-title" className={`scroll-mt-20 border-t border-border/60 ${BAND}`}>
          <div className={`${CONTAINER} grid gap-12 py-20 lg:grid-cols-12 lg:py-28`}>
            <div className="lg:col-span-4">
              <p className={KICKER}>Questions</p>
              <h2 id="faq-title" className={`${H2} mt-3`}>
                What people ask before they start.
              </h2>
            </div>
            <div className="divide-y divide-border/60 border-y border-border/60 lg:col-span-8">
              {FAQ.map((item) => (
                <details key={item.q} className="group py-1">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-6 rounded-md py-4 text-left text-lg font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span
                      aria-hidden="true"
                      className="grid size-7 shrink-0 place-items-center rounded-full border border-border text-lg leading-none text-muted-foreground group-open:hidden"
                    >
                      +
                    </span>
                    <span
                      aria-hidden="true"
                      className="hidden size-7 shrink-0 place-items-center rounded-full border border-border text-lg leading-none text-muted-foreground group-open:grid"
                    >
                      &minus;
                    </span>
                  </summary>
                  <p className="max-w-3xl pb-5 leading-relaxed text-text-secondary">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* The next step */}
        <section aria-labelledby="start-title" className="border-t border-border/60">
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <div className="rounded-2xl bg-[radial-gradient(40rem_20rem_at_85%_-4rem,rgba(147,197,253,0.55),transparent),radial-gradient(30rem_18rem_at_0%_110%,rgba(56,189,248,0.35),transparent),linear-gradient(135deg,#1d3fc4_0%,#2b4fd8_55%,#3b5cf0_100%)] px-6 py-14 text-center text-white shadow-[0_30px_80px_-30px_rgba(43,79,216,0.6)] sm:px-12 lg:py-20">
              <h2 id="start-title" className="mx-auto max-w-2xl text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
                Start with one application you own.
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-white/90">
                Create an account, register a target, prove it is yours, and run your first campaign. Then fix what it
                finds, and test again.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Button asChild className="h-11 px-5 text-base !bg-white !text-[#1d3fc4] hover:!bg-white/90">
                  <Link href="/register">
                    Create an account
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="h-11 px-5 text-base !border-white/70 !bg-transparent !text-white hover:!bg-white/10">
                  <Link href="/login">Log in</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60">
        <div className={`${CONTAINER} flex flex-col gap-10 py-12 md:flex-row md:items-start md:justify-between`}>
          <div className="max-w-sm">
            <p className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
              <SentraLogo size={28} />
              Sentra
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              An AI security and testing platform for applications built on large language models. A capstone project.
            </p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-14 gap-y-8 text-sm sm:grid-cols-3">
            <div>
              <p className="font-medium text-foreground">Page</p>
              <ul className="mt-3 space-y-2">
                {NAV.map((item) => (
                  <li key={item.href}>
                    <a href={item.href} className="inline-block rounded-sm py-1 text-text-secondary outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium text-foreground">Account</p>
              <ul className="mt-3 space-y-2">
                <li>
                  <Link href="/login" className="inline-block rounded-sm py-1 text-text-secondary outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                    Log in
                  </Link>
                </li>
                <li>
                  <Link href="/register" className="inline-block rounded-sm py-1 text-text-secondary outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                    Create account
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-foreground">Project</p>
              <ul className="mt-3 space-y-2">
                <li>
                  <a
                    href="https://github.com/joynto7/Sentra"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block rounded-sm py-1 text-text-secondary outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Source code<span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </li>
              </ul>
            </div>
          </nav>
        </div>
      </footer>
    </div>
  )
}
