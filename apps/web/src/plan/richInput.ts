import {
  AdvisorProfile,
  computePlan,
  emptyPlanPreferences,
  emptyProfileStore,
  goalAnchorsOf,
  ownAccounts,
  planProfileOf,
  type Account,
  type AdvisorProfileStore,
  type EntityProfile,
  type HeldCardInput,
  type PlanEvent,
  type PlanInput,
  type PlanPreferences,
  type PlanProfile,
  type PlanResult,
  type Tx,
} from "@lavega/core";

/** Test support: a plan input with figures in most sections (salary, rent,
 *  groceries, a subscription with a price rise, a debt, a goal, a card). */
let n = 0;
const tx = (counterparty: string, date: string, amount: number, o: Partial<Tx> = {}): Tx => ({
  id: `rich${n++}`,
  accountKey: "A1",
  date,
  amount,
  currency: "EUR",
  counterparty,
  description: "",
  category: "",
  manual: false,
  ...o,
});
const account = (key: string, o: Partial<Account> = {}): Account => ({
  key,
  iban: "",
  name: key,
  bank: "ING",
  entity: "Prive",
  currency: "EUR",
  balance: 2000,
  balanceDate: "2026-10-20",
  ...o,
});

function baseInput(asOf: string): PlanInput {
  const months = [
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
    "2026-03",
    "2026-04",
    "2026-05",
    "2026-06",
    "2026-07",
    "2026-08",
    "2026-09",
  ];
  const txs: Tx[] = [
    ...months.flatMap((m, i) => [
      tx("Employer BV", `${m}-01`, 3000, { category: "Salaris" }),
      tx("Albert Heijn", `${m}-15`, -900 - i * 10, { category: "Boodschappen" }),
      tx("Landlord", `${m}-02`, -1000, { category: "Wonen" }),
      tx("Shop", `${m}-16`, -300, { accountKey: "C1", category: "Boodschappen" }),
      tx("Start", `${m}-01`, 1, { accountKey: "C1", category: "Salaris" }),
    ]),
    ...["2026-04", "2026-05", "2026-06", "2026-07"].map((m) =>
      tx("Netflix", `${m}-05`, -9.99, { category: "Abonnementen" }),
    ),
    ...["2026-08", "2026-09", "2026-10"].map((m) =>
      tx("Netflix", `${m}-05`, -11.79, { category: "Abonnementen" }),
    ),
  ];
  const accounts = [account("A1", { iban: "NL91ABNA0417164300" }), account("C1", { balance: 0 })];
  const profile: PlanProfile = {
    ...planProfileOf(null),
    intakeBlocksDone: 3,
    debts: [
      {
        id: "d1",
        lender: "Lender",
        monthlyCents: 30000,
        balanceCents: 900000,
        ratePct: 9.5,
        source: "confirmed",
        at: "2026-10-01",
      },
    ],
    goals: [
      {
        goal: {
          id: "g1",
          purpose: "Car",
          kind: "general",
          targetCents: 1_000_000,
          targetDate: "2027-03-01",
          priority: "important",
          accountRefs: [],
        },
        since: "2026-01-01",
      },
    ],
    children: [{ id: "c1", birthYear: 2020 }],
    bufferTargetMonths: 3,
    fixedCostsMonthlyCents: 150000,
    incomeStreams: [{ id: "s1", label: "Job", monthlyCents: 300000, regular: true }],
  } as unknown as PlanProfile;
  const card: HeldCardInput = {
    accountKey: "C1",
    label: "Card",
    cashback: { tier: "gemeten", pct: 1, source: "user", updatedAt: "2026-09-01" },
    fee: null,
    fxFeePct: null,
    pointsPerEuro: null,
    programId: null,
  } as HeldCardInput;
  return {
    profile,
    txs,
    accounts,
    entityProfiles: [],
    rules: [],
    own: ownAccounts(accounts),
    rewards: [],
    catalogue: [],
    rates: [],
    heldCards: [card],
    preferences: emptyPlanPreferences(),
    events: [],
    mode: "separate",
    fxHistory: {},
    movedCategories: new Set(),
    asOf,
  };
}

export const richResult = (asOf = "2026-10-24"): PlanResult => computePlan(baseInput(asOf));

/** The same bank data with a real adviser profile behind it, so a test can edit
 *  the profile and recompute. A savings account S1 is added for goal links. */
export function richStore(): AdvisorProfileStore {
  const at = "2026-10-01";
  const stated = "stated" as const;
  return {
    ...emptyProfileStore("2026-10-01T10:00:00Z"),
    current: new AdvisorProfile({
      removed: [],
      intake: { blocksDone: 3, step0: null },
      incomeStreams: [
        {
          value: { id: "s1", label: "Job", monthlyCents: 300000, regular: true },
          source: stated,
          at,
        },
      ],
      housing: { value: { kind: "rent", monthlyCents: 100000 }, source: stated, at },
      children: { value: [{ id: "c1", birthYear: 2020 }], source: stated, at },
      debts: [
        {
          id: "d1",
          lender: "Lender",
          monthlyCents: 30000,
          balanceCents: 900000,
          ratePct: 9.5,
          source: "confirmed",
          at,
        },
      ],
      goals: [
        {
          value: {
            id: "g1",
            purpose: "Car",
            kind: "general",
            targetCents: 1_000_000,
            targetDate: "2027-03-01",
            priority: "important",
            accountRefs: [],
          },
          source: stated,
          at: "2026-01-01",
        },
        {
          value: {
            id: "g2",
            purpose: "Studies",
            kind: "child",
            childId: "c1",
            targetCents: 2_000_000,
            targetDate: "2038-12-31",
            priority: "flexible",
            accountRefs: [],
          },
          source: stated,
          at: "2026-02-01",
        },
      ],
    }),
  };
}

export const richAccounts = (): Account[] => [
  account("A1", { iban: "NL91ABNA0417164300" }),
  account("C1", { balance: 0 }),
  account("S1", { name: "Spaarpot", type: "Spaarrekening", balance: 5000 }),
];

/** The input behind `richResult`, with the profile read from `store`. */
export function richPlanInput(
  store: AdvisorProfileStore,
  o: {
    preferences?: PlanPreferences;
    events?: PlanEvent[];
    entityProfiles?: EntityProfile[];
    accounts?: Account[];
    /** Rewrites the bank data, e.g. to give a merchant a hostile name. */
    mapTxs?: (txs: Tx[]) => Tx[];
    asOf?: string;
  } = {},
): PlanInput {
  const base = baseInput(o.asOf ?? "2026-10-24");
  const accounts = o.accounts ?? richAccounts();
  const prefs = o.preferences ?? emptyPlanPreferences();
  return {
    ...base,
    txs: o.mapTxs ? o.mapTxs(base.txs) : base.txs,
    profile: planProfileOf(store, goalAnchorsOf(o.events ?? [])),
    accounts,
    own: ownAccounts(accounts),
    entityProfiles: o.entityProfiles ?? [],
    preferences: prefs,
    events: o.events ?? [],
    asOf: o.asOf ?? "2026-10-24",
  };
}
