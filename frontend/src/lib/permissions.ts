"use client"

import { useEffect, useState } from "react"

import { useSession } from "@/components/session-provider"
import { apiFetch } from "@/lib/api"

/** Actions of the permission table (FR-1.6), as named by the API. */
export type Action =
  | "manage_organization_security"
  | "manage_members"
  | "manage_targets"
  | "verify_targets"
  | "test_target_connections"
  | "map_target_profiles"
  | "manage_threat_models"
  | "manage_custom_tests"
  | "manage_test_suites"
  | "manage_campaigns"
  | "approve_campaign_scope"
  | "control_campaign_runs"
  | "triage_findings"
  | "request_remediations"
  | "approve_remediations"
  | "manage_shield"
  | "roll_back_shield_policies"
  | "generate_reports"
  | "manage_security_gates"
  | "manage_api_keys_and_webhooks"
  | "view_audit_log"
  | "manage_data_settings"
  | "use_security_lab"

export type RoleInfo = {
  role: string
  label: string
  description: string
  permissions: { action: Action; label: string }[]
}

// The table is the same for everyone, so it is loaded once per page load.
let rolesRequest: Promise<RoleInfo[]> | null = null

export function loadRoles(): Promise<RoleInfo[]> {
  rolesRequest ??= apiFetch<RoleInfo[]>("/v1/organizations/roles").catch((error) => {
    rolesRequest = null
    throw error
  })
  return rolesRequest
}

/**
 * Whether the logged-in member's role may do `action` (undefined while loading). Only used to
 * show or hide controls: the server checks every request itself (FR-1.6).
 */
export function useCan(action: Action): boolean | undefined {
  const role = useSession().organization?.role
  const [allowed, setAllowed] = useState<boolean | undefined>(undefined)
  useEffect(() => {
    let active = true
    loadRoles()
      .then((roles) => {
        const permissions = roles.find((r) => r.role === role)?.permissions ?? []
        if (active) setAllowed(permissions.some((p) => p.action === action))
      })
      .catch(() => active && setAllowed(false))
    return () => {
      active = false
    }
  }, [role, action])
  return allowed
}
