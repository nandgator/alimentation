// Runs before the page is drawn, so a chosen theme never flashes. Every page loads it: the app, the home page,
// the guides and the docs. The stylesheet answers to data-theme as well as to the system setting; with no
// choice stored, the system's setting stays in charge. (`docs-theme` is the key the documentation used before
// the choice was shared.)
try {
  const t = localStorage.getItem('theme') || localStorage.getItem('docs-theme');
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
} catch {
  // Storage can be unavailable (private windows, blocked site data): the system setting applies.
}
