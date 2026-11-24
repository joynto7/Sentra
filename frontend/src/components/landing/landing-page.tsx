import Link from "next/link"
import {
  ArrowRight,
  ArrowUp,
  CircleCheck,
  Fingerprint,
  Gauge,
  Lock,
  RefreshCw,
  ScrollText,
  Server,
  ShieldCheck,
  UserCheck,
  type LucideIcon,
} from "lucide-react"

import {
  NAV,
  SAFETY,
} from "@/components/landing/landing-content"
import { AttackPathBand } from "@/components/landing/attack-path-band"
import { RunDemo } from "@/components/landing/run-demo"
import { FixAgent } from "@/components/landing/fix-agent"
import { FindingFlow } from "@/components/landing/finding-flow"
import { HeroCards } from "@/components/landing/hero-cards"
import { Pillars } from "@/components/landing/pillars"
import { RolesShowcase } from "@/components/landing/roles-showcase"
import { FaqList } from "@/components/landing/faq-list"
import { StepsJourney } from "@/components/landing/steps-journey"
import { ScrollReveal } from "@/components/landing/scroll-reveal"
import { SiteHeader } from "@/components/landing/site-header"
import { SentraLogo } from "@/components/layout/sentra-logo"
import { Button } from "@/components/ui/button"

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
    <div className="landing-light lp-motion min-h-screen overflow-x-clip bg-white text-[#0b1330]">
      <noscript>
        <style>{".lp-motion [data-reveal]{opacity:1!important;transform:none!important;filter:none!important}.lp-motion .lp-draw{stroke-dashoffset:0!important}"}</style>
      </noscript>
      <ScrollReveal />
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
          <div className={`${CONTAINER} grid items-center gap-12 pt-12 pb-16 sm:pt-16 sm:pb-20 lg:grid-cols-12 lg:gap-10 lg:pt-24 lg:pb-28`}>
            <div className="lg:col-span-6">
              <h1
                id="hero-title"
                data-reveal="blur"
                className="text-4xl leading-[1.08] font-medium tracking-tight text-balance text-lp-ink sm:text-5xl lg:text-[3.5rem]"
              >
                Find, prove and fix the weaknesses in your AI applications.
              </h1>
              <p data-reveal data-reveal-delay="140" className="mt-6 max-w-xl text-lg leading-relaxed text-text-secondary sm:text-xl">
                Sentra tests your AI applications, proves each weakness with evidence, and checks every fix.
              </p>
              <div data-reveal data-reveal-delay="280" className="mt-8 flex flex-wrap items-center gap-3">
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

            <div data-reveal data-reveal-delay="420" className="lg:col-span-6">
              <HeroCards />
            </div>
          </div>
        </section>

        {/* Find, prove, fix */}
        <section id="platform" aria-labelledby="platform-title" className="scroll-mt-20 bg-white">
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <div data-reveal="blur" className="mx-auto max-w-3xl text-center">
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

        {/* From the list of findings to one finding's proof and risk */}
        <section aria-labelledby="flow-title" className="bg-white">
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <FindingFlow />
          </div>
        </section>

        {/* The fix: asked for, proposed, approved by a person, tested again */}
        <section aria-labelledby="fix-title" className="bg-lp-wash">
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <FixAgent />
          </div>
        </section>

        {/* A campaign run, alive: the limits, the count, and the buttons to pause or stop */}
        <section aria-labelledby="run-title" className="bg-white">
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <RunDemo />
          </div>
        </section>

        {/* How it works: a dark band, as the reference's, with a card and an icon for each step */}
        <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 bg-lp-navy">
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <h2 id="how-title" data-reveal="blur" className={`${H2} max-w-3xl font-medium text-white`}>
              Four steps to a verified fix.
            </h2>
            <StepsJourney />
          </div>
        </section>

        {/* Use cases */}
        <section id="use-cases" aria-labelledby="use-title" className="scroll-mt-20 bg-white">
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <h2 id="use-title" data-reveal="blur" className={`${H2} max-w-3xl font-medium`}>
              Made for the people who answer for an AI application.
            </h2>
            <RolesShowcase />
          </div>
        </section>

        {/* Safe by design */}
        <section aria-labelledby="safety-title" className="bg-lp-navy">
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <h2 id="safety-title" data-reveal="blur" className={`${H2} max-w-3xl font-medium text-white`}>
              A tool that attacks must be careful.
            </h2>
            <ul className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {SAFETY.map((item, index) => {
                const Icon = SAFETY_ICON[index] ?? ShieldCheck
                return (
                  <li key={item.title} data-reveal data-reveal-delay={120 + (index % 3) * 120}>
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
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <FaqList />
          </div>
        </section>

        {/* The next step: a dark panel with drifting light and the product's own words floating around it */}
        <section aria-labelledby="start-title" className="bg-lp-wash">
          <div className={`${CONTAINER} py-20 lg:py-28`}>
            <div data-reveal="scale" className="relative isolate overflow-hidden rounded-[2rem] bg-lp-navy px-6 py-20 text-center sm:px-12 lg:py-32">
              <span aria-hidden="true" className="absolute -top-28 -left-20 -z-10 size-[26rem] rounded-full bg-primary/45 blur-3xl motion-safe:animate-[lp-drift-a_14s_ease-in-out_infinite]" />
              <span aria-hidden="true" className="absolute -right-24 -bottom-32 -z-10 size-[28rem] rounded-full bg-lp-sky/25 blur-3xl motion-safe:animate-[lp-drift-b_17s_ease-in-out_infinite]" />
              <span
                aria-hidden="true"
                className="absolute inset-0 -z-10 opacity-25 [background-image:radial-gradient(rgba(255,255,255,0.7)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_72%)]"
              />

              {/* What Sentra says, floating */}
              {[
                ["left-[5%] top-[20%]", "Critical → Fixed", CircleCheck, "motion-safe:animate-[lp-float-a_7s_ease-in-out_infinite]"],
                ["right-[6%] top-[16%]", "Retest passed", RefreshCw, "motion-safe:animate-[lp-float-b_8s_ease-in-out_-2s_infinite]"],
                ["left-[9%] bottom-[16%]", "Fix approved by a person", UserCheck, "motion-safe:animate-[lp-float-b_9s_ease-in-out_-4s_infinite]"],
                ["right-[8%] bottom-[20%]", "3 of 3 blocked", ShieldCheck, "motion-safe:animate-[lp-float-a_7.5s_ease-in-out_-1s_infinite]"],
              ].map(([place, text, Icon, motion]) => {
                const Chip = Icon as LucideIcon
                return (
                  <span
                    key={text as string}
                    aria-hidden="true"
                    className={`absolute hidden items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-4 py-2 text-sm text-white backdrop-blur-sm lg:flex ${motion} ${place}`}
                  >
                    <Chip className="size-4 text-lp-sky" />
                    {text as string}
                  </span>
                )
              })}

              <h2 id="start-title" className="mx-auto max-w-3xl text-4xl leading-[1.1] font-medium tracking-tight text-balance text-white sm:text-5xl lg:text-6xl">
                Start with{" "}
                <span className="bg-[linear-gradient(90deg,#8fa7ff,#ffffff,#8fa7ff)] [background-size:200%_100%] bg-clip-text text-transparent motion-safe:animate-[lp-shimmer_6s_linear_infinite]">
                  one application you own.
                </span>
              </h2>
              <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                <Button asChild className="h-12 px-6 text-base shadow-[0_18px_44px_-12px_rgba(43,79,216,0.9)] transition-transform hover:-translate-y-0.5 motion-reduce:transition-none">
                  <Link href="/register">
                    Create an account
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="h-12 px-6 text-base !border-white/30 !bg-transparent !text-white hover:!bg-white/10">
                  <Link href="/login">Log in</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative overflow-hidden bg-lp-navy text-[#c5d0ee]">
        <div className={`${CONTAINER} pt-16`}>
          <div data-reveal className="flex flex-col gap-12 md:flex-row md:items-start md:justify-between">
            <div className="max-w-sm">
              <p className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-white">
                <SentraLogo size={30} />
                Sentra
              </p>
              <p className="mt-3 text-sm leading-relaxed">AI security testing for LLM applications. A capstone project.</p>
              <a
                href="#main-content"
                className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-lp-sky"
              >
                <ArrowUp className="size-4" aria-hidden="true" />
                Back to top
              </a>
            </div>
            <nav aria-label="Footer" className="grid grid-cols-2 gap-x-16 gap-y-8 text-sm sm:grid-cols-3">
              {[
                ["Page", NAV.map((item) => ({ label: item.label, href: item.href }))],
                [
                  "Account",
                  [
                    { label: "Log in", href: "/login" },
                    { label: "Create account", href: "/register" },
                  ],
                ],
                ["Project", [{ label: "Source code", href: "https://github.com/joynto7/Sentra", external: true }]],
              ].map(([title, links]) => (
                <div key={title as string}>
                  <p className="font-medium text-white">{title as string}</p>
                  <ul className="mt-3 space-y-1.5">
                    {(links as { label: string; href: string; external?: boolean }[]).map((link) => (
                      <li key={link.label}>
                        <a
                          href={link.href}
                          {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                          className="inline-block rounded-sm bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1px] bg-bottom bg-no-repeat py-1 text-[#c5d0ee] outline-none transition-[background-size,color] duration-500 hover:bg-[length:100%_1px] hover:text-white focus-visible:ring-2 focus-visible:ring-lp-sky motion-reduce:transition-none"
                        >
                          {link.label}
                          {link.external && <span className="sr-only"> (opens in a new tab)</span>}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
        </div>

        {/* The name, as large as the page, fading into the bottom edge */}
        <div
          aria-hidden="true"
          className="pointer-events-none mt-10 flex justify-center overflow-hidden text-white/[0.08] select-none [mask-image:linear-gradient(to_bottom,black_25%,transparent_96%)]"
        >
          <span className="-mb-[3vw] inline-flex items-center leading-none font-semibold" style={{ fontSize: "min(20vw, 20rem)", letterSpacing: "0.16em" }}>
            SENTR
            <svg viewBox="0 0 20 20" style={{ width: "0.74em", height: "0.8em", marginTop: "-0.08em", overflow: "visible" }}>
              <path d="M2 19 10 1.5 18 19" fill="none" stroke="currentColor" strokeWidth="2.9" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="10" cy="15" r="2.2" fill="#6C8CFF" />
            </svg>
          </span>
        </div>
      </footer>
    </div>
  )
}
