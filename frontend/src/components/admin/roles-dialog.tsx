"use client"

import { useEffect, useState } from "react"
import { Check } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { type RoleInfo, loadRoles } from "@/lib/permissions"

/** "What can each role do?": the permission table of FR-1.6, one card per role. */
export function RolesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [roles, setRoles] = useState<RoleInfo[]>([])
  useEffect(() => {
    loadRoles().then(setRoles).catch(() => undefined)
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>What each role can do</DialogTitle>
          <DialogDescription>
            Every member can see the organization&apos;s targets, campaigns, findings and reports. A role decides what a
            member may change. Sentra checks it on every request.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {roles.map((role) => (
            <section key={role.role} aria-labelledby={`role-${role.role}`} className="rounded-[10px] border p-4">
              <h3 id={`role-${role.role}`} className="text-sm font-semibold">
                {role.label}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{role.description}</p>
              <ul className="mt-3 space-y-1.5">
                {role.permissions.map((p) => (
                  <li key={p.action} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
                    {p.label}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
