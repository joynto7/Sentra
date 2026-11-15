import Link from "next/link"
import {
  ArrowRight,
  Check,
  Fingerprint,
  Gauge,
  Lock,
  Radar,
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
  SAFETY,
  STEPS,
  USE_CASES,
} from "@/components/landing/landing-content"
import { AttackPathBand } from "@/components/landing/attack-path-band"
import { HeroCards } from "@/components/landing/hero-cards"
import { Pillars } from "@/components/landing/pillars"
import { ProductShot } from "@/components/landing/product-shot"
import { SiteHeader } from "@/components/landing/site-header"
import { SentraLogo } from "@/components/layout/sentra-logo"
import { Button } from "@/components/ui/button"

const CAPABILITY_ICON: Record<string, LucideIcon> = {
  evidence: Fingerprint,
  limits: Radar,
  fix: Wrench,
}
const SAFETY_ICON: LucideIcon[] = [Fingerprint, Gauge, UserCheck, ScrollText, Lock, Server]

const CONTAINER = "mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8"
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
        <section aria-labelledby="hero-title" className="border-b border-lp-line bg-lp-wash">
          <div className={`${CONTAINER} grid items-center gap-12 pt-12 pb-16 sm:pt-16 sm:pb-20 lg:grid-cols-12 lg:gap-10 lg:pt-20 lg:pb-24`}>
            <div className="lg:col-span-6">
              <h1
                id="hero-title"
                className="text-4xl leading-[1.08] font-medium tracking-tight text-balance text-lp-ink sm:text-5xl lg:text-[3.25rem]"
              >
                Find, prove and fix the weaknesses in your AI applications.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-text-secondary">
                Sentra tests your AI applications, proves each weakness with evidence, and checks every fix.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild className="h-11 px-5 text-base">
                  <Link href="/register">
                    Create an account
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="h-11 border-lp-line bg-white px-5 text-base hover:bg-white/70">
                  <a href="#how-it-works">See how it works</a>
                </Button>
              </div>
            </div>

            <HeroCards className="lg:col-span-6" />
          </div>
        </section>

        {/* Find, prove, fix */}
        <section id="platform" aria-labelledby="platform-title" className="scroll-mt-20 bg-white">
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <div className="mx-auto max-w-3xl text-center">
              <h2 id="platform-title" className={`${H2} font-medium`}>
                Ordinary testing misses how AI applications fail.
              </h2>
            </div>
            <Pillars />
            <p className="mt-8 text-center text-sm text-lp-muted">Fictional sample data.</p>
          </div>
        </section>

        {/* How single weaknesses combine: the dark band */}
        <section aria-labelledby="paths-title" className="bg-lp-navy">
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <AttackPathBand />
          </div>
        </section>

        {/* Capabilities */}
        <section aria-labelledby="capabilities-title" className="bg-lp-wash">
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <h2 id="capabilities-title" className={`${H2} max-w-3xl font-medium`}>
              Findings you can act on.
            </h2>
            <div className="mt-6 divide-y divide-lp-line">
              {CAPABILITIES.map((capability, index) => {
                const Icon = CAPABILITY_ICON[capability.id]
                const reversed = index % 2 === 1
                return (
                  <article key={capability.id} className="grid items-center gap-10 py-14 lg:grid-cols-12 lg:gap-14 lg:py-20">
                    <div className={`lg:col-span-5 ${reversed ? "lg:order-2" : ""}`}>
                      <span className="grid size-10 place-items-center rounded-xl border border-lp-line bg-white">
                        <Icon className="size-5 text-primary" aria-hidden="true" />
                      </span>
                      <h3 className="mt-4 text-2xl leading-snug font-medium tracking-tight text-balance text-lp-ink sm:text-3xl">
                        {capability.title}
                      </h3>
                      <ul className="mt-6 space-y-3">
                        {capability.points.map((point) => (
                          <li key={point} className="flex gap-3 leading-snug text-lp-ink">
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
        <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 bg-white">
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <h2 id="how-title" className={`${H2} max-w-3xl font-medium`}>
              Four steps to a verified fix.
            </h2>
            <ol className="mt-12 grid gap-8 md:grid-cols-2 xl:grid-cols-4">
              {STEPS.map((step, index) => (
                <li key={step.title} className="rounded-2xl border border-lp-line bg-lp-wash p-6">
                  <span className="grid size-8 place-items-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
                    {index + 1}
                  </span>
                  <h3 className="mt-4 text-xl font-medium tracking-tight text-lp-ink">{step.title}</h3>
                  <p className="mt-2 leading-snug text-text-secondary">{step.outcome}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Use cases */}
        <section id="use-cases" aria-labelledby="use-title" className="scroll-mt-20 bg-lp-wash">
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <h2 id="use-title" className={`${H2} max-w-3xl font-medium`}>
              Made for the people who answer for an AI application.
            </h2>
            <ul className="mt-12 grid gap-4 sm:grid-cols-2">
              {USE_CASES.map((useCase) => (
                <li key={useCase.title} className="rounded-2xl border border-lp-line bg-white p-6">
                  <p className="text-sm font-medium text-link">{useCase.role}</p>
                  <h3 className="mt-2 text-xl leading-snug font-medium tracking-tight text-lp-ink">{useCase.title}</h3>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Safe by design */}
        <section aria-labelledby="safety-title" className="bg-lp-navy">
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <h2 id="safety-title" className={`${H2} max-w-3xl font-medium text-white`}>
              A tool that attacks must be careful.
            </h2>
            <ul className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {SAFETY.map((item, index) => {
                const Icon = SAFETY_ICON[index] ?? ShieldCheck
                return (
                  <li key={item.title}>
                    <span className="grid size-10 place-items-center rounded-xl border border-white/15 bg-white/5">
                      <Icon className="size-5 text-lp-sky" aria-hidden="true" />
                    </span>
                    <h3 className="mt-4 text-lg font-medium tracking-tight text-white">{item.title}</h3>
                    <p className="mt-1.5 leading-snug text-[#c5d0ee]">{item.text}</p>
                  </li>
                )
              })}
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 bg-white">
          <div className={`${CONTAINER} grid gap-12 py-20 lg:grid-cols-12 lg:py-28`}>
            <h2 id="faq-title" className={`${H2} font-medium lg:col-span-4`}>
              Questions
            </h2>
            <div className="divide-y divide-lp-line border-y border-lp-line lg:col-span-8">
              {FAQ.map((item) => (
                <details key={item.q} className="group py-1">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-6 rounded-md py-4 text-left text-lg font-medium text-lp-ink outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full border border-lp-line text-lg leading-none text-lp-muted group-open:hidden">
                      +
                    </span>
                    <span aria-hidden="true" className="hidden size-7 shrink-0 place-items-center rounded-full border border-lp-line text-lg leading-none text-lp-muted group-open:grid">
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
        <section aria-labelledby="start-title" className="bg-lp-wash">
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <div className="rounded-3xl bg-lp-navy px-6 py-14 text-center sm:px-12 lg:py-20">
              <h2 id="start-title" className="mx-auto max-w-2xl text-3xl leading-tight font-medium tracking-tight text-balance text-white sm:text-4xl">
                Start with one application you own.
              </h2>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Button asChild className="h-11 px-5 text-base">
                  <Link href="/register">
                    Create an account
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="h-11 px-5 text-base !border-white/30 !bg-transparent !text-white hover:!bg-white/10">
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
              AI security testing for LLM applications. A capstone project.
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
