/** The first stop of the keyboard on every page with a sidebar: past the menu, to the page itself
 * (WCAG 2.4.1). It stays out of sight until it has the focus. */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-[7px] focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
    >
      Skip to main content
    </a>
  )
}
