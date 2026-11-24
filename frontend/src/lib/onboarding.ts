import { apiFetch } from "@/lib/api"

export type OnboardingAnswers = Partial<Record<"goal" | "first_task" | "team_size" | "experience", string>>

export type Onboarding = {
  done: boolean
  skipped: boolean
  step: number
  answers: OnboardingAnswers
  /** The next question to ask after the setup, one at a time, or null */
  ask: "team_size" | "experience" | null
}

const URL = "/v1/organizations/current/onboarding"

export const getOnboarding = (signal?: AbortSignal) => apiFetch<Onboarding>(URL, { signal })
export const saveOnboarding = (body: { step?: number; answers?: OnboardingAnswers }) =>
  apiFetch<Onboarding>(URL, { method: "PUT", body: JSON.stringify(body) })
export const completeOnboarding = () => apiFetch<Onboarding>(`${URL}/complete`, { method: "POST" })
export const skipOnboarding = () => apiFetch<Onboarding>(`${URL}/skip`, { method: "POST" })
export const restartOnboarding = () => apiFetch<Onboarding>(`${URL}/restart`, { method: "POST" })
