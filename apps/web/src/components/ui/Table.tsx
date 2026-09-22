import {
  createContext,
  forwardRef,
  useContext,
  type HTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils.js";

/* Extracted from the `.table`/`.table-wrap`/`.table-cards` cluster
 * (docs/adr/0005) — 12 tables, ~60 `<th>`, ~60 `<td>` across six views shared
 * that one hand-written cluster; a component keeps the single source of
 * truth instead of duplicating the utility string at each site.
 *
 * `table { border-collapse; width:100% }` (base.css, bare tag, no class)
 * stays — that is what adopting Preflight means, and it is untouched here.
 * Everything that WAS reached through `.table`/`.table-cards` — a class,
 * not a bare tag — moves to these three components; nothing here re-states
 * a property the bare `table` rule already provides (trap 9, ADR).
 *
 * `.table tbody tr:hover` and the `.table-cards` batch rule that turns
 * `table`/`thead`/`tbody`/`tr` into a block box stay expressed as descendant
 * selectors, via Tailwind's `[&_x]` arbitrary variant on <Table> itself,
 * rather than a fourth (Tr) or fifth/sixth (Thead/Tbody) primitive: none of
 * `<thead>`/`<tbody>`/`<tr>` ever carried a class in any of the six views,
 * resolveStyle.ts refuses combinators and a hover media query either way
 * (docs/adr/0005), so there is no test-visible difference between "a flat
 * class on every <tr>" and "a descendant selector on <table>" — and the
 * descendant form is the one that does not ask six views to import and wrap
 * a fourth primitive at every row. Verified in a real browser (report).
 *
 * The per-cell card layout (label/value row, ::before label, border
 * removal) DOES become flat classes directly on <Td> — driven by
 * TableCardsContext rather than a `cards` prop threaded onto every <Td>
 * call site, so a table opts in once, on <Table cards>, and every <Td>
 * beneath it inherits it without restating anything. That flatness is also
 * what makes it resolveStyle-testable, unlike the descendant rules above. */

const TableCardsContext = createContext(false);

/** overflow-x:auto only — extracted from `.table-wrap` for the same reason
 *  as Card: one property, no variants, so a plain `cn()` wrapper is enough. */
const TableWrap = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function TableWrap(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn("overflow-x-auto", className)} {...props} />;
});

/* Below 620px a `cards` table collapses its rows into label/value cards
 * (Transacties, Rekeningen, Optimalisatie's subscription/interest tables,
 * Facturen); `[@media(max-width:620px)]:`, not `max-[620px]:`, because the
 * latter compiles to `not (min-width:620px)`, which EXCLUDES exactly 620px
 * where the original `@media (max-width:620px)` included it (trap 5, ADR). */
const tableVariants = cva("[&_tbody_tr:hover]:bg-surface-2", {
  variants: {
    cards: {
      true:
        "[@media(max-width:620px)]:block [@media(max-width:620px)]:w-full " +
        "[@media(max-width:620px)]:[&_thead]:hidden " +
        "[@media(max-width:620px)]:[&_tbody]:block [@media(max-width:620px)]:[&_tbody]:w-full " +
        "[@media(max-width:620px)]:[&_tr]:block [@media(max-width:620px)]:[&_tr]:w-full " +
        "[@media(max-width:620px)]:[&_tr]:mb-[var(--sp-3)] [@media(max-width:620px)]:[&_tr]:p-[var(--sp-3)] " +
        "[@media(max-width:620px)]:[&_tr]:border [@media(max-width:620px)]:[&_tr]:border-line " +
        "[@media(max-width:620px)]:[&_tr]:rounded-sm [@media(max-width:620px)]:[&_tr]:bg-surface-2",
      false: "",
    },
  },
  defaultVariants: { cards: false },
});

type TableProps = HTMLAttributes<HTMLTableElement> &
  VariantProps<typeof tableVariants> & { "data-testid"?: string };

/* data-testid="table", not the removed `.table` class: facturen-ui.test.tsx
 * found the table via `table.table` as a CSS selector (same reasoning as
 * Button's `data-testid="btn-primary"`, docs/adr/0005). */
const Table = forwardRef<HTMLTableElement, TableProps>(function Table(
  { className, cards, "data-testid": dataTestId, children, ...props },
  ref,
) {
  return (
    <table
      ref={ref}
      data-testid={dataTestId ?? "table"}
      className={cn(tableVariants({ cards }), className)}
      {...props}
    >
      <TableCardsContext.Provider value={cards ?? false}>{children}</TableCardsContext.Provider>
    </table>
  );
});

/* `.table th, table th` (base.css): the bare `table th` half of that selector
 * reached the same declarations as `.table th` — one rule, not a second,
 * hidden one — so converting `.table th` carries the whole rule; nothing is
 * left for the bare-tag fallback to supply (trap 9, ADR). */
const thVariants = cva(
  "border-b border-line px-3 py-2.5 whitespace-nowrap font-mono text-[0.7rem] font-medium uppercase tracking-[0.04em] text-muted",
  {
    /* `.table th.num` (specificity 0,2,1) beat `.table th` (0,1,1) in the
     * hand-written sheet regardless of file order; as utilities that
     * specificity edge is gone, so both variant strings declare `text-*`
     * explicitly and only one is ever selected — modelled as a variant, per
     * trap 8 (ADR), rather than left to Tailwind's own emission order. */
    variants: { numeric: { true: "text-right tabular-nums", false: "text-left" } },
    defaultVariants: { numeric: false },
  },
);

type ThProps = ThHTMLAttributes<HTMLTableCellElement> & VariantProps<typeof thVariants>;

const Th = forwardRef<HTMLTableCellElement, ThProps>(function Th(
  { className, numeric, ...props },
  ref,
) {
  return <th ref={ref} className={cn(thVariants({ numeric }), className)} {...props} />;
});

/* Card-mode cell: label (the `::before`, from `data-label`) and value
 * (the real children) share a flex row, wrapping onto a second line when a
 * cell holds more than one child (bank + IBAN + "Hernoem"). Scoped to
 * <620px the same way as <Table cards>'s own descendant rules, and to the
 * same boundary form (trap 5, ADR). */
const TD_CARDS =
  "[@media(max-width:620px)]:flex [@media(max-width:620px)]:w-full [@media(max-width:620px)]:items-baseline " +
  "[@media(max-width:620px)]:justify-between [@media(max-width:620px)]:flex-wrap [@media(max-width:620px)]:gap-[var(--sp-3)] " +
  "[@media(max-width:620px)]:py-1 [@media(max-width:620px)]:px-0 [@media(max-width:620px)]:border-b-0 " +
  "[@media(max-width:620px)]:[&>*]:min-w-0 [@media(max-width:620px)]:[&>*]:text-right " +
  "[@media(max-width:620px)]:empty:hidden " +
  "[@media(max-width:620px)]:before:content-[attr(data-label)] [@media(max-width:620px)]:before:flex-none " +
  "[@media(max-width:620px)]:before:font-mono [@media(max-width:620px)]:before:text-[0.65rem] [@media(max-width:620px)]:before:uppercase " +
  "[@media(max-width:620px)]:before:tracking-[0.06em] [@media(max-width:620px)]:before:text-muted " +
  "[@media(max-width:620px)]:data-[label='']:before:content-none";

const tdVariants = cva("border-b border-line px-3 py-2.5 text-[0.9rem] text-ink", {
  variants: { numeric: { true: "text-right tabular-nums", false: "text-left" } },
  defaultVariants: { numeric: false },
});

type TdProps = TdHTMLAttributes<HTMLTableCellElement> & VariantProps<typeof tdVariants>;

const Td = forwardRef<HTMLTableCellElement, TdProps>(function Td(
  { className, numeric, ...props },
  ref,
) {
  const cards = useContext(TableCardsContext);
  return (
    <td
      ref={ref}
      className={cn(tdVariants({ numeric }), cards && TD_CARDS, className)}
      {...props}
    />
  );
});

export { Table, TableWrap, Th, Td, TableCardsContext };
export default Table;
