import { useEffect, useRef } from "react";

/**
 * Lets the Back button close a sheet: opening it adds a history entry, and going back (rather than
 * pressing a button) is a way to close it. Closing it any other way takes that entry away again, unless
 * the page has moved on by then (a link inside the sheet is followed with `replace`, which turns the
 * entry into the new page).
 */
export function useBackClosesSheet(open: boolean, close: () => void) {
  const pushed = useRef(false);
  const shut = useRef(close);
  shut.current = close;

  useEffect(() => {
    if (open && !pushed.current) {
      history.pushState({ ...(history.state ?? {}), sheet: true }, "");
      pushed.current = true;
    } else if (!open && pushed.current) {
      pushed.current = false;
      if (history.state?.sheet) history.back();
    }
  }, [open]);

  useEffect(() => {
    const onPop = () => {
      if (!pushed.current) return;
      pushed.current = false;
      shut.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
}
