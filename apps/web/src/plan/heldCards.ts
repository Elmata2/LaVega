import {
  CATALOGUE_KINDS_FOR,
  TRAVEL_AGENT,
  accountCosts,
  accountLabel,
  accountType,
  factEntry,
  factNumber,
  heldCashbackOf,
  isCovered,
  isSpendable,
  lastTermsCheckedForIssuer,
  productOf,
  type Account,
  type CatalogueEntryLike,
  type HeldCardInput,
  type LearnedFact,
  type RewardsBalance,
} from "@lavega/core";

type Provenance = NonNullable<HeldCardInput["provenance"]>;

const norm = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The catalogue row that describes this card: the row the fee matcher named,
 *  else the row whose product is exactly "<bank> <betaalpas|creditcard>". More
 *  than one candidate is no match: a wrong source is worse than none. */
function entryFor(
  account: Account,
  entries: readonly CatalogueEntryLike[],
  feeProductId: string | null,
): CatalogueEntryLike | null {
  if (feeProductId !== null) {
    const byId = entries.find((e) => e.id === feeProductId);
    if (byId !== undefined) return byId;
  }
  const want = norm(productOf(account));
  if (want === "") return null;
  const same = entries.filter((e) => norm(e.product) === want);
  return same.length === 1 ? same[0]! : null;
}

type CostOf = ReturnType<typeof accountCosts>["rows"][number]["cost"];

const feeProductIdOf = (cost: CostOf | undefined): string | null =>
  cost?.kind === "known" && cost.matchedBy === "product-name" ? cost.fee.productId : null;

/** The catalogue ids that the person's card accounts already resolve to, by the
 *  same matcher the held-card list uses. A stated card with one of these ids is
 *  that held card and is not listed a second time. */
export function heldCatalogueIds(
  accounts: readonly Account[],
  entries: readonly CatalogueEntryLike[],
): Set<string> {
  const cards = accounts.filter(isSpendable);
  const costs = new Map(accountCosts(cards, entries).rows.map((r) => [r.account.key, r.cost]));
  const ids = new Set<string>();
  for (const account of cards) {
    const entry = entryFor(account, entries, feeProductIdOf(costs.get(account.key)));
    if (entry !== null) ids.add(entry.id);
  }
  return ids;
}

/** A covered catalogue figure with the date and source it carries; anything
 *  else gives nothing, and the plan then shows the figure as unknown. */
function sourced(
  entry: CatalogueEntryLike | null,
  key: "fxFeePct" | "pointsPerEuro",
): { value: number; provenance: { asOf: string; sourceUrl: string | null } } | null {
  const v = entry?.fields?.[key];
  if (v === undefined || !isCovered(v) || typeof v.value !== "number") return null;
  return { value: v.value, provenance: { asOf: v.checkedAt, sourceUrl: v.sourceUrl ?? null } };
}

/** The rewards programme whose name the card's bank-and-name contains, when
 *  exactly one does. Null otherwise. */
function programFor(account: Account, rewards: readonly RewardsBalance[]): string | null {
  const hay = ` ${norm(`${account.bank ?? ""} ${account.name}`)} `;
  const hits = rewards.filter((r) => {
    const name = norm(r.program);
    return name !== "" && hay.includes(` ${name} `);
  });
  return hits.length === 1 ? hits[0]!.id : null;
}

/** The cards the cards section works on. The cashback state is derived exactly
 *  as Optimalisatie derives it (this is the only place the web layer touches
 *  `heldCashbackOf` for the plan); the fee comes from the same matcher as the
 *  costs lane; fx fee and points rate carry the catalogue row's date and
 *  source, or are left out. */
export function buildHeldCards(i: {
  accounts: Account[];
  facts: readonly LearnedFact[];
  entries: readonly CatalogueEntryLike[];
  rewards: RewardsBalance[];
  assumptionOn: boolean;
}): HeldCardInput[] {
  const cards = i.accounts.filter(isSpendable);
  const costs = new Map(accountCosts(cards, i.entries).rows.map((r) => [r.account.key, r.cost]));
  return cards.map((account) => {
    const product = productOf(account);
    const fact = factEntry(i.facts, TRAVEL_AGENT, product, "cashbackPct");
    const pct = product ? factNumber(i.facts, TRAVEL_AGENT, product, "cashbackPct") : null;
    const kind = accountType(account) === "Creditcard" ? "creditcard" : "betaalpas";
    const cashback = heldCashbackOf({
      issuer: account.bank ?? "",
      kind,
      productName: product,
      fact: pct !== null && fact ? { pct, source: fact.source, updatedAt: fact.updatedAt } : null,
      assumptionOn: i.assumptionOn,
      lastCheckedAt: lastTermsCheckedForIssuer(
        i.entries,
        account.bank ?? "",
        CATALOGUE_KINDS_FOR[kind],
      ),
    });
    const cost = costs.get(account.key);
    const fee =
      cost?.kind !== "known"
        ? null
        : cost.matchedBy === "product-name"
          ? cost.fee
          : (cost.agreeing[0] ?? null);
    const entry = entryFor(account, i.entries, feeProductIdOf(cost));
    const fx = sourced(entry, "fxFeePct");
    const pts = sourced(entry, "pointsPerEuro");
    const provenance: Provenance = {
      ...(fx === null ? {} : { fxFeePct: fx.provenance }),
      ...(pts === null ? {} : { pointsPerEuro: pts.provenance }),
    };
    return {
      accountKey: account.key,
      label: accountLabel(account),
      catalogueId: entry?.id ?? null,
      cashback,
      fee,
      fxFeePct: fx?.value ?? null,
      pointsPerEuro: pts?.value ?? null,
      programId: programFor(account, i.rewards),
      ...(Object.keys(provenance).length === 0 ? {} : { provenance }),
    };
  });
}
