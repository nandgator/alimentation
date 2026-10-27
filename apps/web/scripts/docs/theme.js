// Runs before the page is drawn, so a chosen theme never flashes. The app's own stylesheet answers to
// data-theme as well as to the system setting.
try {
  const t = localStorage.getItem('docs-theme');
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
} catch {
  // Storage can be unavailable (private windows, blocked site data): the system setting applies.
}
