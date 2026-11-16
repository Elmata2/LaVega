/* After the "add a card by file" dialog closes, focus normally returns to the
 * button that opened it. A successful add removes that button (the card is no
 * longer "not connected"), so focus would fall to <body>. Hand it to the main
 * heading of the page instead; never leave it on <body>. */
export function focusAfterFileDialog(root: Document = document): HTMLElement | null {
  const active = root.activeElement;
  if (active && active !== root.body && root.body.contains(active)) return active as HTMLElement;
  const heading = root.querySelector<HTMLElement>("main h1, main h2, h1, h2, [role=main]");
  if (!heading) return null;
  if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
  heading.focus();
  return heading;
}
