"use client"

import { useState } from "react"
import { CircleAlert, CircleCheck } from "lucide-react"
import { toast } from "sonner"

import { FormField } from "@/components/auth/form-field"
import { PasswordInput } from "@/components/auth/password-input"
import { CopyButton } from "@/components/sentra/copy-button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ApiError, fieldErrors } from "@/lib/api"
import {
  type SsoConnection,
  type SsoDetails,
  disconnectSso,
  saveSso,
  testSso,
} from "@/lib/sso"

const EMPTY: SsoDetails = {
  protocol: "oidc",
  email_domain: "",
  issuer: "",
  client_id: "",
  client_secret: "",
}

const blank = (connection: SsoConnection): SsoDetails => ({
  ...EMPTY,
  email_domain: connection.email_domain ?? "",
  issuer: connection.issuer ?? "",
  client_id: connection.client_id ?? "",
})

/**
 * Screen 11, the "Single sign-on" card (UC-1.7 steps 4-6 with 4a and 5a). The connection is
 * tested before it is saved, and the client secret is typed once and never shown again
 * (quality requirement 4) — so a connected organization that changes anything types it again.
 */
export function SsoCard({
  connection,
  onChange,
}: {
  connection: SsoConnection
  onChange: (connection: SsoConnection) => void
}) {
  const [details, setDetails] = useState<SsoDetails>(() => blank(connection))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [tested, setTested] = useState<{ ok: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState<"test" | "save" | "off" | null>(null)

  const set = (field: keyof SsoDetails) => (value: string) => {
    setDetails((before) => ({ ...before, [field]: value }))
    setTested(null) // what was proved was proved about the old details
  }

  const complete =
    !!details.email_domain.trim() &&
    !!details.issuer.trim() &&
    !!details.client_id.trim() &&
    !!details.client_secret.trim()

  function problem(error: unknown): void {
    const named = fieldErrors(error)
    setErrors(named)
    if (!Object.keys(named).length) {
      setTested({
        ok: false,
        message: error instanceof ApiError ? error.message : "Something went wrong. Try again.",
      })
    }
  }

  async function test() {
    setBusy("test")
    setErrors({})
    try {
      setTested(await testSso(details))
    } catch (error) {
      problem(error)
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    setBusy("save")
    setErrors({})
    try {
      const saved = await saveSso(details)
      onChange(saved)
      setDetails(blank(saved))
      setTested(null)
      toast.success("Single sign-on settings are saved", {
        description: `Members with an @${saved.email_domain} address are sent to your identity provider at login. Ask one of them to log in once to confirm it works.`,
      })
    } catch (error) {
      problem(error)
    } finally {
      setBusy(null)
    }
  }

  async function off() {
    setBusy("off")
    try {
      const saved = await disconnectSso()
      onChange(saved)
      setDetails(EMPTY)
      setTested(null)
      toast.success("Single sign-on is disconnected", {
        description: "Members log in with their Sentra password again. Nobody lost their account.",
      })
    } catch (error) {
      problem(error)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="sso-heading" className="space-y-5 rounded-[10px] border bg-card p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="sso-heading" className="text-[15px] font-semibold">
          Single sign-on
        </h2>
        <span
          className={
            connection.connected
              ? "rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success"
              : "rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-text-secondary"
          }
        >
          {connection.connected ? `Saved · @${connection.email_domain}` : "Not connected"}
        </span>
      </div>

      {connection.connected && (
        <p role="status" className="rounded-[7px] border bg-muted/40 p-3 text-[13px] text-text-secondary">
          {connection.tested_at
            ? `The connection test passed when these settings were saved (${new Date(connection.tested_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}).`
            : "These settings were saved without a connection test."}{" "}
          That shows the provider answers, not that a member can log in: Sentra records no login through the provider,
          so one member&apos;s first login is the only proof.
        </p>
      )}

      <p className="text-sm text-text-secondary">
        Sentra connects an identity provider over <strong className="font-medium">OpenID Connect</strong>.
        {connection.connected
          ? " To change anything, enter the details again — the client secret is never shown after it is saved."
          : " Create an application for Sentra at your provider, then enter what it gives you."}
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <FormField id="sso-domain" label="E-mail domain" error={errors.email_domain} announce>
          <Input
            id="sso-domain"
            value={details.email_domain}
            onChange={(e) => set("email_domain")(e.target.value)}
            placeholder="example.com"
            className="h-9"
            aria-invalid={errors.email_domain ? true : undefined}
            aria-describedby="sso-domain-help"
          />
          <p id="sso-domain-help" className="mt-1.5 text-xs text-muted-foreground">This domain logs in through your provider.</p>
        </FormField>
        <FormField id="sso-issuer" label="Issuer URL" error={errors.issuer} announce>
          <Input
            id="sso-issuer"
            value={details.issuer}
            onChange={(e) => set("issuer")(e.target.value)}
            placeholder="https://login.example.com"
            className="h-9"
            aria-invalid={errors.issuer ? true : undefined}
            aria-describedby="sso-issuer-help"
          />
          <p id="sso-issuer-help" className="mt-1.5 text-xs text-muted-foreground">
            Sentra reads{" "}
            <span className="break-all">
              {details.issuer.trim()
                ? `${details.issuer.trim().replace(/\/$/, "")}/.well-known/openid-configuration`
                : "its /.well-known/openid-configuration"}
            </span>{" "}
            to find the rest.
          </p>
        </FormField>
        <FormField id="sso-client" label="Client ID" error={errors.client_id} announce>
          <Input
            id="sso-client"
            value={details.client_id}
            onChange={(e) => set("client_id")(e.target.value)}
            className="h-9"
            aria-invalid={errors.client_id ? true : undefined}
          />
        </FormField>
        <FormField id="sso-secret" label="Client secret" error={errors.client_secret} announce>
          <PasswordInput
            id="sso-secret"
            value={details.client_secret}
            onChange={set("client_secret")}
            autoComplete="off"
            invalid={!!errors.client_secret}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">Stored encrypted. Not shown again.</p>
        </FormField>
      </div>

      <div className="rounded-[10px] border bg-muted/40 p-4">
        <h3 className="text-sm font-medium">Copy this into your identity provider</h3>
        <p className="mt-1 text-xs text-text-secondary">The only address Sentra accepts answers at.</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 rounded-[7px] border bg-background px-3 py-2 font-mono text-[13px] break-all">
            {connection.redirect_uri}
          </code>
          <CopyButton text={connection.redirect_uri} description="Copy the redirect URI" />
        </div>
      </div>

      {tested && (
        <Alert variant={tested.ok ? "default" : "destructive"} role="alert">
          {tested.ok ? <CircleCheck aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
          <AlertDescription>
            {tested.ok ? tested.message : `Connection test failed: ${tested.message} Nothing was saved.`}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
        {connection.connected && (
          <Button
            type="button"
            variant="outline"
            className="mr-auto h-9"
            onClick={off}
            disabled={busy !== null}
          >
            {busy === "off" ? "Disconnecting…" : "Disconnect"}
          </Button>
        )}
        <Button type="button" variant="outline" className="h-9" onClick={test} disabled={!complete || busy !== null}>
          {busy === "test" ? "Testing…" : "Test connection"}
        </Button>
        <Button
          type="button"
          className="h-9 hover:bg-primary-hover"
          onClick={save}
          disabled={!complete || busy !== null}
        >
          {busy === "save" ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </section>
  )
}
