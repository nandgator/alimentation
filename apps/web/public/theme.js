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

// A theme chosen by hand dissolves into the other instead of switching: the browser keeps a picture of the page as
// it was and fades it into the page as it is (the length of the fade is `--dur-4`, see styles.css). Where the
// browser cannot, or motion is reduced, the colours simply change. Every control that changes the theme goes
// through this, so the home page, the app, the guides and the docs all change colour the same way.
window.fadeTheme = function (apply) {
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    apply();
    return;
  }
  const root = document.documentElement;
  root.classList.add('theme-fading');
  const done = () => root.classList.remove('theme-fading');
  document.startViewTransition(apply).finished.then(done, done);
};
