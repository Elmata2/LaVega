/* Focus-trap helpers shared by the phone drawer and the assistant sheet. */

const TABBABLE = "a[href], button:not([disabled]), summary, input, select, textarea, [tabindex]";

export function tabbables(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => {
    if (el.tabIndex < 0) return false;
    const details = el.closest("details");
    // Content of a closed <details> is not reachable; its <summary> is.
    return !details || details.open || el.closest("summary")?.parentElement === details;
  });
}

/** Wrap Tab / Shift+Tab at both ends of `panel`; pull stray focus back in. */
export function trapTab(e: KeyboardEvent, panel: HTMLElement): void {
  const items = tabbables(panel);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (!panel.contains(active)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}
