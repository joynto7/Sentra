/** Sentra logo: cobalt rounded square with a white shield-and-check outline. */
export function SentraLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="7" fill="#2B4FD8" />
      <path
        d="M14 6.5 20 8.8v4.6c0 3.9-2.5 6.9-6 8.1-3.5-1.2-6-4.2-6-8.1V8.8l6-2.3Z"
        fill="none"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="m11.2 14 2 2 3.8-4"
        fill="none"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
