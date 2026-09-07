import {useEffect} from "react";

/** Sets the document title per route — "Schedule #10 — Slope", etc. */
export function usePageTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} — Slope` : "Slope — adaptive execution";
  }, [title]);
}
