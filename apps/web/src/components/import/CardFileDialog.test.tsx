// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ingest, parseBankFile } from "@lavega/core";
import CardFileDialog, { type CardFileDialogProps } from "./CardFileDialog";
import type { CardTarget } from "../../lib/cardFileImport";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AMEX: CardTarget = {
  id: "american-express-platinum",
  name: "American Express Platinum",
  brand: "amex",
  kind: "credit",
};
const T212: CardTarget = {
  id: "212-card",
  name: "Trading 212 Card",
  brand: "trading-212",
  kind: "debit",
};

/* Synthetic exports. */
const AMEX_CSV = `Date,Description,Card Member,Account #,Amount,Appears on Your Statement As,Extended Details
03/05/2026,SHOP ONE,A TESTER,-11111,10.00,SHOP ONE,x
03/07/2026,SHOP TWO,A TESTER,-11111,20.00,SHOP TWO,x`;
const ING_CSV = `"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen"
"20260102";"Albert Heijn";"NL01INGB0001";"";"BA";"Af";"12,34";"Betaalautomaat";"Boodschappen"`;

let root: Root | null = null;
let el: HTMLElement | null = null;
beforeEach(() => {
  document.cookie = "lavega_locale=nl";
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  el?.remove();
  root = null;
  el = null;
});

function mount(over: Partial<CardFileDialogProps> = {}) {
  const onCommit = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, count: 2 }));
  const onClose = vi.fn();
  const onDone = vi.fn();
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  function Host() {
    const [open, setOpen] = useState(true);
    return (
      <CardFileDialog
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        card={AMEX}
        choices={[]}
        entity="Privé"
        accounts={[]}
        txs={[]}
        asOf="2026-11-16"
        onCommit={onCommit}
        onDone={onDone}
        {...over}
      />
    );
  }
  act(() => root!.render(<Host />));
  return { onCommit, onClose, onDone };
}

const dialog = () => document.querySelector("dialog")!;
const button = (label: RegExp | string) =>
  [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    typeof label === "string" ? b.textContent === label : label.test(b.textContent ?? ""),
  )!;

async function feed(name: string, content: string, type = "text/csv") {
  const input = dialog().querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File([content], name, { type });
  await act(async () => {
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

test("names the card and shows where it works and the numbered steps", () => {
  mount();
  expect(dialog().querySelector("h2")!.textContent).toBe("American Express Platinum toevoegen");
  expect(dialog().textContent).toContain("Via de website van American Express, op je computer.");
  expect(dialog().querySelectorAll('[data-testid="guide-steps"] li')).toHaveLength(4);
});

test("Trading 212 says it is in the app", () => {
  mount({ card: T212 });
  expect(dialog().textContent).toContain("In de Trading 212-app.");
});

test("without a card it first offers the not-connected cards, then Andere bank of kaart", () => {
  mount({ card: null, choices: [AMEX, T212] });
  const labels = [...dialog().querySelectorAll("li button")].map((b) => b.textContent);
  expect(labels).toEqual(["American Express Platinum", "Trading 212 Card", "Andere bank of kaart"]);
  act(() => button("Andere bank of kaart").click());
  expect(dialog().textContent).toContain("Download een CSV- of MT940-export");
});

test("preview shows format, period, counts and writes nothing before Toevoegen", async () => {
  const { onCommit } = mount();
  await feed("amex.csv", AMEX_CSV);
  const text = dialog().querySelector('[data-testid="file-preview"]')!.textContent!;
  expect(text).toContain("2 nieuwe transacties");
  expect(text).toContain("0 stonden er al in · 5 mrt – 7 mrt 2026 · herkend als American Express");
  expect(onCommit).not.toHaveBeenCalled();
  await act(async () => button("Toevoegen").click());
  expect(onCommit).toHaveBeenCalledTimes(1);
});

test("success says how many were added and calls onDone", async () => {
  const { onDone } = mount();
  await feed("amex.csv", AMEX_CSV);
  await act(async () => button("Toevoegen").click());
  expect(dialog().querySelector('[role="status"][data-testid="card-file-done"]')!.textContent).toBe(
    "2 transacties toegevoegd aan American Express Platinum.",
  );
  expect(onDone).toHaveBeenCalledWith(2);
});

test("wrong issuer is flagged and needs an explicit choice", async () => {
  mount();
  await feed("ing.csv", ING_CSV);
  expect(dialog().querySelector('[role="alert"]')!.textContent).toContain(
    "Je koos American Express Platinum",
  );
  expect(button("Toevoegen").disabled).toBe(true);
  act(() => button(/Toch toevoegen/).click());
  expect(button("Toevoegen").disabled).toBe(false);
});

test("a PDF gets its specific reason and cannot be added", async () => {
  mount();
  await feed("afschrift.pdf", "%PDF-1.4", "application/pdf");
  expect(dialog().querySelector('[data-testid="file-preview"]')!.textContent).toContain(
    "Dit is een PDF. Kies CSV of Excel.",
  );
  expect(button("Toevoegen").disabled).toBe(true);
});

test("a failed save shows an alert and nothing is claimed saved", async () => {
  const onCommit = vi.fn(async (..._a: unknown[]) => ({ ok: false as const, partial: false }));
  mount({ onCommit });
  await feed("amex.csv", AMEX_CSV);
  await act(async () => button("Toevoegen").click());
  expect(dialog().querySelector('[role="alert"]')!.textContent).toContain("Er is niets opgeslagen");
});

test("Escape before confirm closes and writes nothing", async () => {
  const { onCommit, onClose } = mount();
  await feed("amex.csv", AMEX_CSV);
  act(() => {
    dialog().dispatchEvent(new Event("cancel", { cancelable: true }));
  });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onCommit).not.toHaveBeenCalled();
});

test("focus moves into the dialog on open", () => {
  mount();
  expect(dialog().contains(document.activeElement)).toBe(true);
});

test("all controls have names and the file input accepts the statement types", () => {
  mount();
  for (const b of dialog().querySelectorAll("button")) {
    expect((b.textContent ?? "").trim() !== "" || b.getAttribute("aria-label")).toBeTruthy();
  }
  const input = dialog().querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(input.multiple).toBe(true);
  expect(input.accept).toContain(".xlsx");
  expect(input.getAttribute("aria-label")).toBeTruthy();
});

const AMEX_A = `Date,Description,Card Member,Account #,Amount,Appears on Your Statement As,Extended Details
03/01/2026,ROW ONE,A,-11111,1.00,ROW ONE,x
03/02/2026,ROW TWO,A,-11111,2.00,ROW TWO,x`;
const AMEX_B = `Date,Description,Card Member,Account #,Amount,Appears on Your Statement As,Extended Details
03/02/2026,ROW TWO,A,-11111,2.00,ROW TWO,x
03/03/2026,ROW THREE,A,-11111,3.00,ROW THREE,x`;

test("overlapping files: first previews 2 new, second 1 new", async () => {
  mount();
  await feed("a.csv", AMEX_A);
  await feed("b.csv", AMEX_B);
  const cards = [...dialog().querySelectorAll('[data-testid="file-preview"]')].map((e) => e.textContent!);
  expect(cards[0]).toContain("2 nieuwe transacties");
  expect(cards[1]).toContain("1 nieuwe transactie");
  expect(cards[1]).not.toContain("1 nieuwe transacties");
});

test("when every file has nothing new, Toevoegen is disabled and says why", async () => {
  const held = ingest([], parseBankFile("a.csv", AMEX_A).txs);
  mount({ txs: held });
  await feed("a.csv", AMEX_A);
  const t = dialog().querySelector('[data-testid="file-preview"]')!.textContent!;
  expect(t).toContain("Niets nieuws: alle 2 transacties stonden er al in.");
  expect(button("Toevoegen").disabled).toBe(true);
});

test("an .xls shows the clear message and no raw error", async () => {
  mount();
  await feed("old.xls", "x", "application/vnd.ms-excel");
  const t = dialog().querySelector('[data-testid="file-preview"]')!.textContent!;
  expect(t).toContain("Dit is een oud Excel-bestand (.xls). Kies CSV of .xlsx.");
  expect(dialog().querySelector<HTMLInputElement>('input[type="file"]')!.accept).not.toContain(".xls,");
  expect(dialog().querySelector<HTMLInputElement>('input[type="file"]')!.accept).not.toContain(".xml");
});

test("Escape, the cross and the backdrop do nothing while the write runs", async () => {
  let release: (v: { ok: true; count: number }) => void = () => {};
  const onCommit = vi.fn(() => new Promise<{ ok: true; count: number }>((r) => (release = r)));
  const { onClose } = mount({ onCommit });
  await feed("a.csv", AMEX_A);
  await act(async () => {
    button("Toevoegen").click();
  });
  act(() => {
    dialog().dispatchEvent(new Event("cancel", { cancelable: true }));
    dialog().querySelector<HTMLButtonElement>(".ui-dialog-close")!.click();
    dialog().click();
  });
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => release({ ok: true, count: 2 }));
  expect(dialog().querySelector('[data-testid="card-file-done"]')).not.toBeNull();
});

test("a failed write says nothing saved, a partial one says not everything", async () => {
  const none = vi.fn(async () => ({ ok: false as const, partial: false }));
  mount({ onCommit: none });
  await feed("a.csv", AMEX_A);
  await act(async () => button("Toevoegen").click());
  expect(dialog().querySelector('[role="alert"]')!.textContent).toContain("Er is niets opgeslagen");
});

test("a partial failure is not described as nothing saved", async () => {
  const some = vi.fn(async () => ({ ok: false as const, partial: true }));
  mount({ onCommit: some });
  await feed("a.csv", AMEX_A);
  await act(async () => button("Toevoegen").click());
  const t = dialog().textContent!;
  expect(t).toContain("Niet alles is opgeslagen. Controleer je rekeningen en probeer het opnieuw.");
  expect(t).not.toContain("niets opgeslagen");
});

test("success moves focus to the Sluiten button", async () => {
  mount();
  await feed("a.csv", AMEX_A);
  await act(async () => button("Toevoegen").click());
  expect(document.activeElement).toBe(button("Sluiten"));
});

test("the steps stay visible and collapse into a disclosure once a file is chosen", async () => {
  mount();
  const details = () => dialog().querySelector("details")!;
  expect(details().open).toBe(true);
  expect(dialog().textContent).not.toContain("CAMT");
  await feed("a.csv", AMEX_A);
  expect(details().open).toBe(false);
  expect(dialog().querySelector('button[aria-label="a.csv verwijderen"]')).not.toBeNull();
});

test("small screens get the phone note under the steps; the steps are never hidden", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  try {
    mount();
    expect(dialog().querySelectorAll('[data-testid="guide-steps"] li')).toHaveLength(4);
    expect(dialog().querySelector('[data-testid="phone-note"]')!.textContent).toBe(
      "Op je telefoon lukt deze download meestal niet. Doe dit op je computer en upload het bestand daar.",
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

const legacyAmex = {
  key: "AMEX-2026",
  iban: "",
  name: "AMEX-2026",
  bank: "American Express",
  entity: "P",
  currency: "EUR",
  balance: null,
  linkedAt: "2026-01-01",
};

test("every preview says where the rows go", async () => {
  mount();
  await feed("a.csv", AMEX_A);
  expect(dialog().querySelector('[data-testid="destination"]')!.textContent).toBe(
    "Nieuwe rekening: American Express Platinum",
  );
});

test("a legacy account: the question blocks Toevoegen until answered, both answers work", async () => {
  mount({ accounts: [legacyAmex] });
  await feed("a.csv", AMEX_A);
  const q = () => dialog().querySelector('[data-testid="same-card-question"]');
  expect(q()!.textContent).toContain("Je hebt al een American Express-rekening: AMEX-2026. Is dit dezelfde kaart?");
  expect(button("Toevoegen").disabled).toBe(true);
  // While the question is open there are no misleading counts.
  expect(dialog().querySelector('[data-testid="file-preview"]')!.textContent).not.toContain("Niets nieuws");
  act(() => button("Ja, voeg toe aan AMEX-2026").click());
  expect(q()).toBeNull();
  expect(button("Toevoegen").disabled).toBe(false);
  expect(dialog().querySelector('[data-testid="destination"]')!.textContent).toBe("Komt in: AMEX-2026");
});

test("answering no imports as a separate account", async () => {
  mount({ accounts: [legacyAmex] });
  await feed("a.csv", AMEX_A);
  act(() => button("Nee, dit is een andere kaart").click());
  expect(dialog().querySelector('[data-testid="destination"]')!.textContent).toBe(
    "Nieuwe rekening: American Express Platinum",
  );
  expect(button("Toevoegen").disabled).toBe(false);
});

test("when fewer rows were stored than previewed, the success line says so", async () => {
  const onCommit = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, count: 1 }));
  mount({ onCommit });
  await feed("a.csv", AMEX_A); // previews 2 new
  await act(async () => button("Toevoegen").click());
  expect(dialog().querySelector('[data-testid="card-file-done"]')!.textContent).toBe(
    "1 transactie toegevoegd aan American Express Platinum. 1 stond er intussen al in.",
  );
});

test("a throwing commit never leaves the dialog stuck: alert shown, Escape works again", async () => {
  const onCommit = vi.fn(async () => {
    throw new Error("boom");
  });
  const { onClose } = mount({ onCommit });
  await feed("a.csv", AMEX_A);
  await act(async () => button("Toevoegen").click());
  expect(dialog().querySelector('[role="alert"]')).not.toBeNull();
  expect(dialog().textContent).not.toContain("boom");
  act(() => {
    dialog().dispatchEvent(new Event("cancel", { cancelable: true }));
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});
