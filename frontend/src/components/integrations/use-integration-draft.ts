"use client"

import { useCallback, useMemo, useState } from "react"

import { useSession } from "@/components/session-provider"
import { DraftUnsupportedError, useDraftFeedback } from "@/components/wizard/use-draft-feedback"
import {
  type StoredDraft,
  clearIntegrationDraft,
  integrationDraftKey,
  readIntegrationDraft,
  writeIntegrationDraft,
} from "@/components/integrations/integration-drafts"

export const useIntegrationDraftKey = (kind: "api-key" | "webhook") => {
  const session = useSession()
  return integrationDraftKey(kind, session.id, session.organization?.id ?? "")
}

/**
 * The device-local draft of one dialog: what was kept the last time (offered, never applied by
 * itself), the honest feedback about the draft being written, and the ways to restore or discard
 * it. The values it receives are already limited to non-secret fields by the sanitizers.
 */
export function useIntegrationDraft<T>(kind: "api-key" | "webhook", sanitize: (raw: unknown) => T | null, isEmpty: (value: T) => boolean) {
  const key = useIntegrationDraftKey(kind)
  const [offered, setOffered] = useState<StoredDraft<T> | null>(() => {
    const found = typeof window === "undefined" ? null : readIntegrationDraft(key, sanitize)
    return found && !isEmpty(found.value) ? found : null
  })
  const adapter = useMemo(
    () => ({
      save(value: T) {
        if (isEmpty(value)) {
          clearIntegrationDraft(key)
          return { savedAt: new Date().toISOString() }
        }
        const savedAt = writeIntegrationDraft(key, value)
        if (!savedAt) throw new DraftUnsupportedError("This browser doesn't allow a draft to be kept")
        return { savedAt }
      },
    }),
    [key, isEmpty],
  )
  const { feedback, noteEdit, retry, restored, reset } = useDraftFeedback<T>(adapter)
  const accept = useCallback(() => {
    if (offered) restored(offered.savedAt)
    setOffered(null)
  }, [offered, restored])
  const discard = useCallback(() => {
    clearIntegrationDraft(key)
    setOffered(null)
    reset()
  }, [key, reset])
  return { feedback, noteEdit, retry, offered, accept, discard }
}
