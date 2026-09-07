/**
 * Polling that respects the tab: hidden tabs stop querying. Several screens
 * poll the subgraph continuously; a forgotten background tab would keep
 * burning the Studio key's rate budget for nobody.
 */
export function startPolling(fn: () => void, ms: number): () => void {
  const tick = () => {
    if (!document.hidden) fn();
  };
  const timer = window.setInterval(tick, ms);
  const onVisible = () => {
    if (!document.hidden) fn();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
