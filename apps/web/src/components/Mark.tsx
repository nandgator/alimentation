/** The mark's square, and the box the drawing fills inside it, in the mark's own units. */
export const MARK_BOX = { size: 24, x: 3.6, y: 2.4, width: 16.8, height: 20.2 } as const;

/**
 * A ledger (a bahi): a book in the ink of the page, ruled across, with a saffron tick that marks the place.
 * With `packing`, each of four rulings has a saffron stripe over it that a page can fill, one after another,
 * as it is read (see `.mark-fill`). The tick is the only saffron the brand uses.
 */
export function Mark({ size = 26, packing = false }: { size?: number; packing?: boolean }) {
  return (
    <svg
      className="mark"
      viewBox={`0 0 ${MARK_BOX.size} ${MARK_BOX.size}`}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3.6" y="2.4" width="16.8" height="20.2" rx="2.6" fill="currentColor" />
      <rect
        x="6.4"
        y="7.6"
        width="6.6"
        height="1.6"
        rx="0.8"
        fill="var(--background)"
        opacity="0.85"
      />
      <rect
        x="6.4"
        y="11.6"
        width="11.2"
        height="1.8"
        rx="0.9"
        fill="var(--background)"
        opacity="0.85"
      />
      <rect
        x="6.4"
        y="16"
        width="11.2"
        height="1.8"
        rx="0.9"
        fill="var(--background)"
        opacity="0.85"
      />
      <rect
        x="6.4"
        y="20.3"
        width="11.2"
        height="1.6"
        rx="0.8"
        fill="var(--background)"
        opacity="0.85"
      />
      <path d="M14.8 2.4h3.2v7.6l-1.6-1.4-1.6 1.4z" fill="var(--highlight)" />
      {packing ? (
        <>
          <rect
            className="mark-fill mark-fill-1"
            x="6.4"
            y="11.6"
            width="11.2"
            height="1.8"
            rx="0.9"
          />
          <rect
            className="mark-fill mark-fill-2"
            x="6.4"
            y="16"
            width="11.2"
            height="1.8"
            rx="0.9"
          />
          <rect
            className="mark-fill mark-fill-3"
            x="6.4"
            y="20.3"
            width="11.2"
            height="1.6"
            rx="0.8"
          />
          <rect
            className="mark-fill mark-fill-4"
            x="6.4"
            y="7.6"
            width="6.6"
            height="1.6"
            rx="0.8"
          />
        </>
      ) : null}
    </svg>
  );
}
