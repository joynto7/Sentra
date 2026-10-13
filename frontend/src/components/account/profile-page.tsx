"use client"

import { useEffect, useRef, useState } from "react"
import { MailCheck } from "lucide-react"
import { toast } from "sonner"

import { AccountNav } from "@/components/account/account-nav"
import { FormField } from "@/components/auth/form-field"
import { PasswordInput } from "@/components/auth/password-input"
import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { NotificationPreferences } from "@/components/notifications/notification-preferences"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { type Profile, cancelEmailChange, getProfile, requestEmailChange, updateProfile } from "@/lib/account"
import { ApiError } from "@/lib/api"

function problems(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return { form: "Something went wrong. Try again." }
  const found: Record<string, string> = {}
  for (const detail of error.details ?? []) found[detail.field] = detail.message
  return Object.keys(found).length ? found : { form: error.message }
}

/** Screen 08, "Personal details": UC-1.11 steps 1-3 and alternative 2a (a new e-mail address). */
export function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [failed, setFailed] = useState(false)
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [changing, setChanging] = useState(false)
  const [newEmail, setNewEmail] = useState("")
  const [password, setPassword] = useState("")
  const [emailErrors, setEmailErrors] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const changeButton = useRef<HTMLButtonElement>(null)
  const newEmailInput = useRef<HTMLInputElement>(null)

  usePageCrumbs([{ label: "Account", href: "/account/profile" }, { label: "Profile" }])

  function show(loaded: Profile) {
    setProfile(loaded)
    setName(loaded.name)
    setPhone(loaded.phone ?? "")
  }

  useEffect(() => {
    getProfile()
      .then(show)
      .catch(() => setFailed(true))
  }, [])

  // The e-mail fields open below the address; the focus moves into them and back afterwards.
  useEffect(() => {
    if (changing) newEmailInput.current?.focus()
  }, [changing])

  if (failed) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>Your profile could not be loaded. Reload the page to try again.</AlertDescription>
      </Alert>
    )
  }

  const dirty = !!profile && (name !== profile.name || phone !== (profile.phone ?? ""))

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setErrors({})
    setSaving(true)
    try {
      show(await updateProfile(name, phone.trim() || null))
      toast.success("Profile saved")
    } catch (error) {
      const found = problems(error)
      setErrors(found)
      const first = ["name", "phone"].find((field) => found[field])
      if (first) document.getElementById(first)?.focus()
    } finally {
      setSaving(false)
    }
  }

  async function sendLink(event: React.FormEvent) {
    event.preventDefault()
    setEmailErrors({})
    const found: Record<string, string> = {}
    if (!newEmail.trim()) found.email = "Enter the new address."
    if (!password) found.password = "Enter your password to confirm."
    if (Object.keys(found).length) {
      setEmailErrors(found)
      return
    }
    setSending(true)
    try {
      await requestEmailChange(newEmail.trim(), password)
      show(await getProfile())
      toast.success(`We sent a link to ${newEmail.trim()}`, { description: "Your address changes once you open it." })
      closeChange()
    } catch (error) {
      setEmailErrors(problems(error))
    } finally {
      setSending(false)
    }
  }

  function closeChange() {
    setChanging(false)
    setNewEmail("")
    setPassword("")
    setEmailErrors({})
    requestAnimationFrame(() => changeButton.current?.focus())
  }

  async function cancelPending() {
    await cancelEmailChange().catch(() => undefined)
    show(await getProfile())
    toast.success("The change of address was cancelled")
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <AccountNav />
      <div className="min-w-0 flex-1 space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your personal details, as other members of your organization see them.</p>
        </div>

        {!profile ? (
          <div className="space-y-3" role="status" aria-label="Loading your profile">
            <Skeleton className="h-72 w-full" />
          </div>
        ) : (
          <section aria-labelledby="details-heading" className="max-w-2xl space-y-5 rounded-[10px] border bg-card p-6">
            <h2 id="details-heading" className="text-[15px] font-semibold">
              Personal details
            </h2>
            {errors.form && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{errors.form}</AlertDescription>
              </Alert>
            )}
            <form id="profile-form" onSubmit={save} noValidate className="space-y-4">
              <FormField id="name" label="Full name" error={errors.name}>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  maxLength={200}
                  className="h-9"
                  aria-invalid={!!errors.name || undefined}
                  aria-describedby={errors.name ? "name-error" : undefined}
                />
              </FormField>
            </form>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span id="email-label" className="text-sm font-medium">
                  Work e-mail
                </span>
                {!changing && (
                  <Button
                    ref={changeButton}
                    type="button"
                    variant="link"
                    className="h-auto px-0 text-xs"
                    aria-label="Change work e-mail"
                    onClick={() => setChanging(true)}
                  >
                    Change
                  </Button>
                )}
              </div>
              <p className="text-sm">{profile.email}</p>
              {profile.pending_email && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-muted/50 p-3 text-sm" role="status">
                  <MailCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    Waiting for confirmation: open the link we sent to <span className="font-medium">{profile.pending_email}</span>.
                  </span>
                  <Button type="button" variant="outline" size="sm" className="h-8" onClick={cancelPending}>
                    Cancel change
                  </Button>
                </div>
              )}
              {changing ? (
                <form onSubmit={sendLink} noValidate className="space-y-4 rounded-[10px] border p-4">
                  <FormField id="new-email" label="New work e-mail" error={emailErrors.email}>
                    <Input
                      ref={newEmailInput}
                      id="new-email"
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      autoComplete="email"
                      className="h-9"
                      aria-invalid={!!emailErrors.email || undefined}
                      aria-describedby={emailErrors.email ? "new-email-error new-email-help" : "new-email-help"}
                    />
                    <p id="new-email-help" className="text-xs text-muted-foreground">
                      We&apos;ll send a link to confirm a new address before it changes.
                    </p>
                  </FormField>
                  <FormField id="email-password" label="Confirm with your password" error={emailErrors.password}>
                    <PasswordInput
                      id="email-password"
                      value={password}
                      onChange={setPassword}
                      autoComplete="current-password"
                      invalid={!!emailErrors.password}
                    />
                  </FormField>
                  {emailErrors.form && (
                    <p role="alert" className="text-sm text-destructive">
                      {emailErrors.form}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" className="h-9" onClick={closeChange}>
                      Cancel
                    </Button>
                    <Button type="submit" className="h-9 hover:bg-primary-hover" disabled={sending}>
                      {sending ? "Sending…" : "Send confirmation link"}
                    </Button>
                  </div>
                </form>
              ) : (
                !profile.pending_email && (
                  <p className="text-xs text-muted-foreground">We&apos;ll send a link to confirm a new address before it changes.</p>
                )
              )}
            </div>

            <FormField id="phone" label="Phone (optional)" error={errors.phone}>
              <Input
                id="phone"
                form="profile-form"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                className="h-9 sm:max-w-xs"
                aria-invalid={!!errors.phone || undefined}
                aria-describedby={errors.phone ? "phone-error" : undefined}
              />
            </FormField>

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" className="h-9" disabled={!dirty || saving} onClick={() => show(profile)}>
                Cancel
              </Button>
              <Button type="submit" form="profile-form" className="h-9 hover:bg-primary-hover" disabled={!dirty || saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </section>
        )}
        <NotificationPreferences />
      </div>
    </div>
  )
}
