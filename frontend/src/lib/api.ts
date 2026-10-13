/** Base URL of the Sentra API (FastAPI). */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api"

/** Error returned by the API: {"error": {"code", "message", "details"?}}. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { field: string; message: string }[],
  ) {
    super(message)
    this.name = "ApiError"
  }
}

/** Calls the API and returns the JSON body, or throws an ApiError. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...init.headers },
    })
  } catch {
    throw new ApiError(0, "network_error", "Sentra could not reach the server. Try again.")
  }

  const body = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    const error = body?.error
    throw new ApiError(
      response.status,
      error?.code ?? `http_${response.status}`,
      error?.message ?? "Something went wrong. Try again.",
      error?.details,
    )
  }
  return body as T
}
