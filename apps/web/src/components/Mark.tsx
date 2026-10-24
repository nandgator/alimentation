/** A plate seen from above, with a small bowl on its rim. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle
        cx="12"
        cy="12"
        r="5.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.55"
      />
      <circle cx="15.7" cy="8.4" r="2" fill="var(--copper)" />
    </svg>
  );
}
