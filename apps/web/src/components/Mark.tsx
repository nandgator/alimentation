/**
 * A tiffin carrier: a handle, a lid, three tiers, and the clips that hold them together. With `packing`, each tier
 * has a turmeric stripe inside it that a page can fill, one tier after another, as it is read (see `.mark-fill`).
 */
export function Mark({ size = 26, packing = false }: { size?: number; packing?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <rect x="7" y="2.4" width="10" height="1.8" rx="0.9" fill="currentColor" />
      <rect x="8.6" y="3.8" width="1.6" height="3.2" fill="currentColor" />
      <rect x="13.8" y="3.8" width="1.6" height="3.2" fill="currentColor" />
      <rect x="4.6" y="6.8" width="14.8" height="3" rx="1.5" fill="currentColor" />
      <rect x="5.6" y="10.8" width="12.8" height="3.4" rx="1.7" fill="currentColor" />
      <rect x="5.6" y="15.2" width="12.8" height="3.4" rx="1.7" fill="currentColor" />
      <rect x="5.6" y="19.6" width="12.8" height="3" rx="1.5" fill="currentColor" />
      <rect x="3.6" y="7" width="1.8" height="14.4" rx="0.9" fill="var(--accent)" />
      <rect x="18.6" y="7" width="1.8" height="14.4" rx="0.9" fill="var(--accent)" />
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
            x="5.6"
            y="7.6"
            width="12.8"
            height="1.4"
            rx="0.7"
          />
        </>
      ) : null}
    </svg>
  );
}
