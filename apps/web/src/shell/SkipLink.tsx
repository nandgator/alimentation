/** The first stop of the page: a link that jumps past the menus, shown only when it has focus. */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only z-70 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
    >
      Skip to content
    </a>
  );
}
