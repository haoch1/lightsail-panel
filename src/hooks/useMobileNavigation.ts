import { useEffect, useRef } from "react";

export function useMobileNavigation(open: boolean, close: () => void) {
  const sidebar = useRef<HTMLElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const resize = () => {
      if (!media.matches) closeRef.current();
    };
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);

  useEffect(() => {
    if (!open) return;
    const overflow = document.body.style.overflow;
    const previous = document.activeElement as HTMLElement | null;
    const controls = () =>
      Array.from(
        sidebar.current?.querySelectorAll<HTMLElement>(
          "a[href],button:not(:disabled),[tabindex]",
        ) || [],
      ).filter(
        (element) => element.tabIndex >= 0 && element.getClientRects().length,
      );
    document.body.style.overflow = "hidden";
    (
      sidebar.current?.querySelector<HTMLElement>('[aria-current="page"]') ||
      controls()[0]
    )?.focus({ preventScroll: true });

    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      } else if (event.key === "Tab") {
        const elements = controls();
        const first = elements[0],
          last = elements.at(-1);
        const outside = !sidebar.current?.contains(document.activeElement);
        if (event.shiftKey && (document.activeElement === first || outside)) {
          event.preventDefault();
          last?.focus({ preventScroll: true });
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || outside)
        ) {
          event.preventDefault();
          first?.focus({ preventScroll: true });
        }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      document.body.style.overflow = overflow;
      const target = opener.current?.getClientRects().length
        ? opener.current
        : previous;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [open]);

  return { sidebar, opener };
}
