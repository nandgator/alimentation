/** A tiffin carrier: a handle, a lid, three tiers, and the clips that hold them together. */
export function Mark({ size = 26 }: { size?: number }) {
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
    </svg>
  );
}
