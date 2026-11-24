"use client"

import { useEffect, useState } from "react"
import { Lock } from "lucide-react"

import { Switch } from "@/components/ui/switch"
import { type Preference, getPreferences, savePreferences } from "@/lib/notifications"

/**
 * Screen 08, card "Notifications": which events reach the user in the application and by e-mail
 * (FR-9.3, UC-1.11 step 2). Each switch is saved when you change it and shows its new position only after Sentra has saved it; account security alerts stay on.
 */
export function NotificationPreferences() {
  const [preferences, setPreferences] = useState<Preference[] | null>(null)
  const [status, setStatus] = useState("")
  const [failed, setFailed] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    getPreferences()
      .then((found) => {
        setPreferences(found)
        setFailed(null)
      })
      .catch(() => setFailed("Your notification settings could not be loaded."))
  }, [attempt])

  // A switch changes only after the server has answered: while it is saving the switch keeps its
  // old position and is disabled, so what is shown is what is kept.
  async function change(preference: Preference, channel: "in_app" | "email", on: boolean) {
    const key = `${preference.event}:${channel}`
    const what = `${preference.label}, ${channel === "email" ? "e-mail" : "in-app"}`
    setPending(key)
    setStatus(`Saving ${what}…`)
    setFailed(null)
    try {
      const next = { ...preference, [channel]: on }
      setPreferences(await savePreferences([{ event: next.event, in_app: next.in_app, email: next.email }]))
      setStatus(`Saved: ${what} ${on ? "on" : "off"}.`)
    } catch {
      setStatus("")
      setFailed(`${what} was not changed, because it could not be saved. It is still ${preference[channel] ? "on" : "off"}. Try again.`)
    } finally {
      setPending(null)
    }
  }

  return (
    <section id="notifications" aria-labelledby="notifications-heading" className="max-w-2xl scroll-mt-20 space-y-4 rounded-[10px] border bg-card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="notifications-heading" className="text-[15px] font-semibold">
          Notifications
        </h2>
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
          {status}
        </p>
      </div>
      {failed && (
        <p role="alert" className="flex flex-wrap items-center gap-3 text-[13px] text-destructive">
          {failed}
          {!preferences && (
            <button type="button" className="rounded text-link underline underline-offset-2" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          )}
        </p>
      )}
      {!preferences && !failed && <p className="text-[13px] text-muted-foreground" role="status">Loading your notification settings…</p>}
      {preferences && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th scope="col" className="py-2 text-left font-medium">
                Event
              </th>
              <th scope="col" className="w-20 py-2 text-center font-medium">
                In-app
              </th>
              <th scope="col" className="w-20 py-2 text-center font-medium">
                E-mail
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {preferences.map((preference) => (
              <tr key={preference.event}>
                <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                  <span className="flex items-start gap-2">
                    {preference.locked && <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    <span>
                      {preference.label}
                      {preference.locked && (
                        <span className="block text-xs text-muted-foreground">Always on for your protection.</span>
                      )}
                    </span>
                  </span>
                </th>
                {(["in_app", "email"] as const).map((channel) => (
                  <td key={channel} className="py-2.5 text-center">
                    <Switch
                      checked={preference[channel]}
                      disabled={preference.locked || pending !== null}
                      aria-busy={pending === `${preference.event}:${channel}`}
                      aria-label={`${preference.label}: ${channel === "email" ? "e-mail" : "in-app"}`}
                      onCheckedChange={(on) => change(preference, channel, on)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-muted-foreground">
        E-mails contain a short summary and a link. Evidence and secrets are never sent by e-mail.
      </p>
    </section>
  )
}
