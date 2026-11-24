import { type Draft, saveDraft } from "@/components/campaigns/builder/setup"
import { type DraftAdapter, DraftUnsupportedError } from "@/components/wizard/use-draft-feedback"

/**
 * The campaign draft as it is kept today: in this browser only (localStorage, one key per user and
 * organization). `saveDraft` answers with the time it was kept, or null when the browser refused
 * (blocked or full storage); that is reported as "can't be kept here", never as saved.
 * Not wired into the builder yet: that is the first task of Phase 02.
 */
export function localDraftAdapter(key: string): DraftAdapter<Draft> {
  return {
    save(draft) {
      const savedAt = saveDraft(key, draft)
      if (!savedAt) throw new DraftUnsupportedError("This browser doesn't allow a draft to be kept")
      return { savedAt }
    },
  }
}
