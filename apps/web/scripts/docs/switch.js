// Tells the page that has just opened which way it was reached, so that going between the guides and the docs
// can glide the way the switch has them: the guides on the left, the docs on the right. Everything else about
// the move is in docs.css. A browser that cannot move one page into another this way just opens the page.
(() => {
  const side = (path) => (path.startsWith('/docs') ? 2 : path.startsWith('/guides') ? 1 : 0);
  addEventListener('pagereveal', (e) => {
    const from = (typeof navigation === 'undefined' ? undefined : navigation)?.activation?.from
      ?.url;
    if (!e.viewTransition || !from) return;
    const was = side(new URL(from).pathname);
    const now = side(location.pathname);
    if (was && now && was !== now) e.viewTransition.types.add(now === 2 ? 'to-docs' : 'to-guides');
  });
})();
