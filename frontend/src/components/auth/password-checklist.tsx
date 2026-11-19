import { Circle, CircleCheck, CircleX } from "lucide-react"

// Same wording as the password policy in the backend (m01_users/password_policy.py).
const LENGTH = "At least 12 characters"
const COMMON = "Not a commonly used or breached password"
const EMAIL = "Doesn't contain your e-mail address"

type State = "met" | "not-met" | "unknown"

function containsEmail(password: string, email: string): boolean {
  const lowered = password.toLowerCase()
  const address = email.toLowerCase()
  const localPart = address.split("@")[0]
  return (address.length > 0 && lowered.includes(address)) || (localPart.length >= 3 && lowered.includes(localPart))
}

/**
 * Live checklist under a new password. The common-password check runs on the server,
 * so that item is only marked after the form was sent (`serverError`).
 */
export function PasswordChecklist({
  password,
  email,
  serverError,
}: {
  password: string
  email?: string
  serverError?: string
}) {
  const typed = password.length > 0
  const items: { label: string; state: State }[] = [
    { label: LENGTH, state: !typed ? "unknown" : password.length >= 12 ? "met" : "not-met" },
    { label: COMMON, state: serverError?.includes(COMMON) ? "not-met" : "unknown" },
    {
      label: EMAIL,
      state:
        email === undefined
          ? serverError?.includes(EMAIL)
            ? "not-met"
            : "unknown"
          : !typed
            ? "unknown"
            : containsEmail(password, email)
              ? "not-met"
              : "met",
    },
  ]

  return (
    <ul className="mt-2 space-y-1" aria-label="Password requirements">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-xs">
          {item.state === "met" && <CircleCheck className="size-3.5 text-success" aria-hidden="true" />}
          {item.state === "not-met" && <CircleX className="size-3.5 text-destructive" aria-hidden="true" />}
          {item.state === "unknown" && <Circle className="size-3.5 text-muted-foreground" aria-hidden="true" />}
          <span className={item.state === "not-met" ? "text-destructive" : "text-muted-foreground"}>
            {item.label}
            <span className="sr-only">
              {item.state === "met" ? " (met)" : item.state === "not-met" ? " (not met)" : ""}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}
