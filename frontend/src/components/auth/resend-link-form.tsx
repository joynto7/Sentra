"use client"

import { useState } from "react"

import { FormField } from "@/components/auth/form-field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { apiFetch } from "@/lib/api"

/** Asks for the e-mail address and sends a new confirmation link. */
export function ResendLinkForm() {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    await apiFetch("/v1/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email }),
    }).catch(() => undefined)
    setSent(true)
  }

  if (sent) {
    return <p className="text-sm">If the address belongs to an unconfirmed account, we&apos;ve sent a new link.</p>
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FormField id="email" label="Work e-mail">
        <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-9" />
      </FormField>
      <Button type="submit" className="h-9 w-full hover:bg-primary-hover">
        Send a new link
      </Button>
    </form>
  )
}
