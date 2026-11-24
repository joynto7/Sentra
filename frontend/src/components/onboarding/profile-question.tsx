"use client"

import { useEffect, useState } from "react"

import { EXPERIENCE_LABEL, QUESTIONS } from "@/components/onboarding/model"
import { Button } from "@/components/ui/button"
import { getOnboarding, saveOnboarding } from "@/lib/onboarding"

const LATER = "sentra.profile-question.later"

/**
 * One optional question on the dashboard, after the setup: asked once the person has seen the
 * product, one at a time, never blocking. Answering saves it and the next question waits for the
 * next visit; "Later" hides it for this browser session.
 */
export function ProfileQuestion() {
  const [ask, setAsk] = useState<"team_size" | "experience" | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    try {
      if (window.sessionStorage.getItem(LATER)) return
    } catch {
      // storage blocked: the question simply shows
    }
    getOnboarding()
      .then((found) => alive && setAsk(found.ask))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  if (!ask) return null
  const question = QUESTIONS[ask]

  async function answer(value: string) {
    setError(false)
    try {
      await saveOnboarding({ answers: { [ask as string]: value } })
      setAsk(null)
    } catch {
      setError(true)
    }
  }

  return (
    <section aria-label="One question" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border bg-card px-4 py-3">
      <p className="text-sm font-medium">{question.title}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={question.title}>
        {question.choices.map((choice) => (
          <Button key={choice} type="button" variant="outline" size="sm" className="h-8" onClick={() => void answer(choice)}>
            {ask === "experience" ? (EXPERIENCE_LABEL[choice] ?? choice) : choice}
          </Button>
        ))}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="ml-auto h-8 text-muted-foreground"
        onClick={() => {
          try {
            window.sessionStorage.setItem(LATER, "1")
          } catch {
            // nothing kept; it shows again on the next page load
          }
          setAsk(null)
        }}
      >
        Later
      </Button>
      {error && (
        <p role="alert" className="basis-full text-[13px] text-destructive">
          That did not save. Try again.
        </p>
      )}
    </section>
  )
}
