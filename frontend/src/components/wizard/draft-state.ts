/**
 * What a guided workflow may honestly say about its draft. Pure, with no React and no storage, so
 * that the rules can be tested alone.
 *
 * The one rule that matters: a save is acknowledged for the edit it carried. When the person has
 * edited again since, the draft is not "saved", and a late answer from an older save never changes that.
 */
export type DraftPhase = "clean" | "unsaved" | "saving" | "saved" | "failed" | "unsupported"

export type DraftFeedback = {
  phase: DraftPhase
  /** Counts every change the person made; the latest one is the one that must be saved */
  edit: number
  /** The latest edit that a save has been acknowledged for */
  savedEdit: number
  savedAt: string | null
  error: string | null
}

export type DraftEvent =
  | { type: "edited" }
  | { type: "saveStarted"; edit: number }
  | { type: "saved"; edit: number; at: string }
  | { type: "failed"; edit: number; message: string }
  | { type: "restored"; at: string }
  | { type: "unsupported" }
  | { type: "reset" }

export const CLEAN: DraftFeedback = { phase: "clean", edit: 0, savedEdit: 0, savedAt: null, error: null }

export function draftReducer(state: DraftFeedback, event: DraftEvent): DraftFeedback {
  switch (event.type) {
    case "reset":
      return CLEAN
    case "unsupported":
      return { ...state, phase: "unsupported", error: null }
    case "restored":
      return { ...CLEAN, phase: "saved", savedAt: event.at }
    case "edited": {
      const edit = state.edit + 1
      // Where nothing can be kept, an edit stays unsupported rather than turning into "unsaved"
      return state.phase === "unsupported" ? { ...state, edit } : { ...state, edit, phase: "unsaved", error: null }
    }
    case "saveStarted":
      if (state.phase === "unsupported" || event.edit !== state.edit) return state
      return { ...state, phase: "saving", error: null }
    case "saved": {
      if (state.phase === "unsupported" || event.edit <= state.savedEdit) return state
      // Covers the latest edit: saved. Otherwise a newer edit is still waiting.
      return {
        ...state,
        savedEdit: event.edit,
        savedAt: event.at,
        error: null,
        phase: event.edit === state.edit ? "saved" : "unsaved",
      }
    }
    case "failed":
      // An answer about an edit that a later save has already covered, or that has been edited since, says nothing new
      if (state.phase === "unsupported" || event.edit <= state.savedEdit || event.edit !== state.edit) return state
      return { ...state, phase: "failed", error: event.message }
  }
}

/** Whether the latest edit still has to be sent to the place that keeps the draft. */
export const needsSave = (state: DraftFeedback) => state.edit > state.savedEdit && state.phase !== "unsupported"
