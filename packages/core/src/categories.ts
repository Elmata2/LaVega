import { norm } from "./hash.js";

/** Normalisation used ONLY for category matching — never for transaction
 *  identity. `norm` (hash.ts) is load-bearing for `tx.id`, so it must keep
 *  lowercasing and collapsing whitespace and nothing more; this one is free to
 *  be looser. On top of `norm` it:
 *    - strips diacritics, so "Café" / "Pathé" / "Univé" match plain-ASCII entries;
 *    - DROPS apostrophes and dots, so "Domino's" == "dominos" (including the
 *      curly ’ some exports use) and "K.v.K." == "kvk", "A.S.R." == "asr";
 *    - turns the remaining separators (`- / , * + _ ; : ( )` …) into spaces, so
 *      the real counterparty strings banks deliver — "Nationale-Nederlanden",
 *      "T-Mobile", "CCV*ALBERT HEIJN" — match a plainly-written entry.
 *  It is applied to BOTH sides (entry and transaction text), so a rule the owner
 *  typed with a hyphen keeps working too.
 *
 *  `&` is deliberately left alone: collapsing it would shorten "h&m" / "c&a"
 *  into two-letter needles that substring-match unrelated words. */
export const matchNorm = (s: unknown): string =>
  norm(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019`.]/g, "")
    .replace(/[-\u2013\u2014_/\\,;:*+()[\]{}|"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/* Built-in Dutch category defaults. These apply automatically in categorize()
 * AFTER a user's own rules (and a manual tx.category), so they give sensible
 * categories out of the box for the average Dutch household while any
 * user-defined rule or manual override still wins.
 *
 * Matching is the same as user rules: the (matchNorm'd) `match` string is tested
 * as a substring of matchNorm(counterparty + " " + description). Three
 * consequences shaped this list:
 *   1. ORDER MATTERS — the first match wins, so a specific product is listed
 *      before a broader merchant ("amazon prime" -> Entertainment appears above
 *      "amazon" -> Online shopping; "uber eats"/"bolt food" -> Eten sit above
 *      "uber"/"bolt" -> Transport).
 *   2. NO SHORT/AMBIGUOUS TOKENS — a match is a plain substring, so entries that
 *      would collide with common words are avoided (e.g. bare "spar" is a
 *      substring of "sparen" and would mislabel savings transfers; "ret",
 *      "cak", bare "bp"/"total"/"cz" are omitted for the same reason).
 *   3. AN AMBIGUOUS WORD NEEDS A `sign` — the same word means different things
 *      in the two directions ("salaris" incoming is the owner's income; the same
 *      word outgoing is a company paying wages). Such an entry carries
 *      `sign: "in" | "out"` and only applies to that direction. Without a sign
 *      an entry applies to both, as before. A word that is ambiguous even WITH a
 *      sign is left out entirely — an unmatched transaction stays "onbekend",
 *      which is honest; a guessed category is not.
 *
 * (The accented duplicates — "cafe"/"café" — are now redundant because matchNorm
 * strips diacritics. They are harmless and left in place.) */

export type CategoryRule = {
  match: string;
  category: string;
  sign?: "in" | "out";
  /** A rule that names a payment MECHANISM rather than a merchant. It is held
   *  back until every reading of WHO the counterparty is has been tried, so a
   *  betaalverzoek from a person is booked between people (his instruction) and
   *  only a betaalverzoek from something that is not a person falls back on the
   *  mechanism. */
  weak?: true;
};

/** Een afbetaling aan je eigen creditcard. Eigen categorie omdat de statistieklaag
 *  hem moet kunnen uitsluiten zonder elke andere overboeking mee te nemen. */
export const CREDIT_CARD_PAYMENT_CATEGORY = "Creditcard afbetaald";

export const NL_CATEGORY_RULES: readonly CategoryRule[] = [
  /* BETAALVERZOEK — a Dutch payment request, and always a transfer between people
   * rather than a purchase. Every bank prints the phrase in the counterparty
   * ("T.J. van Wijngaarden via Rabo Betaalverzoek", "via ING Betaalverzoek"), so
   * the phrase itself is the rule.
   *
   * Both entries are `weak` since the 20-08-2026 review: he was explicit that a
   * booking from one person to another is NOT "Overboekingen", and the person in
   * "T.J. van Wijngaarden via Rabo Betaalverzoek" is right there in the
   * counterparty. So the name is read first, and "Overboekingen" is what is left
   * when the requester is not a person — a club collecting a contribution, say.
   * Both directions: he pays some and is paid others. */
  { match: "betaalverzoek", category: "Overboekingen", weak: true },
  { match: "tikkie", category: "Overboekingen", weak: true },
  // --- overlap priority: specific product before its broader merchant ---
  { match: "amazon prime", category: "Entertainment" },
  { match: "prime video", category: "Entertainment" },
  { match: "amazon music", category: "Entertainment" },
  { match: "google play", category: "Entertainment" },
  { match: "youtube premium", category: "Entertainment" },
  { match: "apple.com/bill", category: "Abonnementen" },
  { match: "microsoft 365", category: "Abonnementen" },
  { match: "office 365", category: "Abonnementen" },

  // --- Zakelijke software, cloud & hosting. These sit at the TOP for two
  //     reasons: "amazon web services" must beat "amazon" -> Online shopping,
  //     and on a company account this block is where most of the month's spend
  //     actually goes — without it a BV's Top-uitgaven is dominated by
  //     "onbekend". Deliberately absent: the payment processors (Stripe,
  //     Mollie, Adyen). Their rows are revenue in one direction and fees in the
  //     other, and a substring rule cannot tell which — see rule 3 above. ---
  { match: "amazon web services", category: "Abonnementen" },
  { match: "aws emea", category: "Abonnementen" },
  { match: "google workspace", category: "Abonnementen" },
  { match: "google cloud", category: "Abonnementen" },
  { match: "microsoft azure", category: "Abonnementen" },
  { match: "anthropic", category: "Abonnementen" },
  { match: "github", category: "Abonnementen" },
  { match: "gitlab", category: "Abonnementen" },
  { match: "atlassian", category: "Abonnementen" },
  { match: "slack technologies", category: "Abonnementen" },
  { match: "figma", category: "Abonnementen" },
  { match: "vercel", category: "Abonnementen" },
  { match: "netlify", category: "Abonnementen" },
  { match: "cloudflare", category: "Abonnementen" },
  { match: "digitalocean", category: "Abonnementen" },
  { match: "hetzner", category: "Abonnementen" },
  { match: "supabase", category: "Abonnementen" },
  { match: "twilio", category: "Abonnementen" },
  { match: "mailchimp", category: "Abonnementen" },
  { match: "hubspot", category: "Abonnementen" },
  { match: "zoom video", category: "Abonnementen" },
  { match: "calendly", category: "Abonnementen" },
  { match: "typeform", category: "Abonnementen" },
  { match: "airtable", category: "Abonnementen" },
  { match: "zapier", category: "Abonnementen" },
  { match: "transip", category: "Abonnementen" },
  { match: "hostnet", category: "Abonnementen" },
  { match: "mijndomein", category: "Abonnementen" },
  { match: "namecheap", category: "Abonnementen" },
  { match: "godaddy", category: "Abonnementen" },
  { match: "moneybird", category: "Abonnementen" },
  { match: "exact online", category: "Abonnementen" },
  { match: "e-boekhouden", category: "Abonnementen" },
  { match: "snelstart", category: "Abonnementen" },
  { match: "twinfield", category: "Abonnementen" },

  // --- Boodschappen ---
  { match: "albert heijn", category: "Boodschappen" },
  { match: "ah to go", category: "Boodschappen" },
  { match: "ah xl", category: "Boodschappen" },
  { match: "appie", category: "Boodschappen" },
  { match: "jumbo", category: "Boodschappen" },
  { match: "lidl", category: "Boodschappen" },
  { match: "aldi", category: "Boodschappen" },
  { match: "plus supermarkt", category: "Boodschappen" },
  { match: "dirk van den broek", category: "Boodschappen" },
  { match: "dirk vd broek", category: "Boodschappen" },
  { match: "coop supermarkt", category: "Boodschappen" },
  { match: "dekamarkt", category: "Boodschappen" },
  { match: "vomar", category: "Boodschappen" },
  { match: "hoogvliet", category: "Boodschappen" },
  { match: "poiesz", category: "Boodschappen" },
  { match: "boni", category: "Boodschappen" },
  { match: "jan linders", category: "Boodschappen" },
  { match: "nettorama", category: "Boodschappen" },
  { match: "ekoplaza", category: "Boodschappen" },
  { match: "marqt", category: "Boodschappen" },
  { match: "picnic", category: "Boodschappen" },
  { match: "crisp", category: "Boodschappen" },
  { match: "gorillas", category: "Boodschappen" },
  { match: "getir", category: "Boodschappen" },
  { match: "bakkerij", category: "Boodschappen" },
  { match: "bakker bart", category: "Boodschappen" },
  { match: "slagerij", category: "Boodschappen" },
  { match: "slager", category: "Boodschappen" },
  { match: "kaashandel", category: "Boodschappen" },
  { match: "groenteboer", category: "Boodschappen" },
  { match: "toko", category: "Boodschappen" },
  { match: "avondwinkel", category: "Boodschappen" },
  { match: "supermarkt", category: "Boodschappen" },

  // --- Zuid-Europese kaartbetalingen. Measured, not guessed: over the owner's
  //     real exports (1.394 rows that stayed "onbekend") the abroad rows are
  //     Iberian and French card descriptors — PRT=48, ESP=35, FRA=16 — and they
  //     are supermarkets, bakeries and bars, NOT one "buitenland" category.
  //     Which is the point: a foreign transaction is not a category, it is a
  //     circumstance, so what is added here is the merchant TYPE.
  //     Preferring the generic Romance words over individual chain names is
  //     deliberate — "supermercado"/"panaderia" generalise to every trip, a
  //     chain name only to the one town he was in. All of them are checked
  //     against rule 2 above: none is a substring of a Dutch word.
  //     ("continente" was measured and deliberately LEFT OUT: it is a substring
  //     of the Dutch "incontinente" and would mislabel a pharmacy row.) ---
  { match: "supermercado", category: "Boodschappen" },
  { match: "mercadona", category: "Boodschappen" },
  { match: "mercearia", category: "Boodschappen" },
  { match: "alimentacion", category: "Boodschappen" },
  { match: "panaderia", category: "Boodschappen" },
  { match: "padaria", category: "Boodschappen" },
  { match: "carniceria", category: "Boodschappen" },
  { match: "frutas", category: "Boodschappen" },

  // --- Eten & drinken (must precede Transport for uber eats / bolt food) ---
  { match: "thuisbezorgd", category: "Eten & drinken" },
  { match: "takeaway", category: "Eten & drinken" },
  { match: "uber eats", category: "Eten & drinken" },
  { match: "ubereats", category: "Eten & drinken" },
  { match: "bolt food", category: "Eten & drinken" },
  { match: "deliveroo", category: "Eten & drinken" },
  { match: "dominos", category: "Eten & drinken" },
  { match: "domino's", category: "Eten & drinken" },
  { match: "new york pizza", category: "Eten & drinken" },
  { match: "mcdonald", category: "Eten & drinken" },
  { match: "burger king", category: "Eten & drinken" },
  { match: "kfc", category: "Eten & drinken" },
  { match: "subway", category: "Eten & drinken" },
  { match: "febo", category: "Eten & drinken" },
  { match: "kwalitaria", category: "Eten & drinken" },
  { match: "starbucks", category: "Eten & drinken" },
  { match: "coffee company", category: "Eten & drinken" },
  { match: "la place", category: "Eten & drinken" },
  { match: "bagels beans", category: "Eten & drinken" },
  { match: "restaurant", category: "Eten & drinken" },
  { match: "eetcafe", category: "Eten & drinken" },
  { match: "eetcafé", category: "Eten & drinken" },
  { match: "grand cafe", category: "Eten & drinken" },
  { match: "grand café", category: "Eten & drinken" },
  { match: "cafe", category: "Eten & drinken" },
  { match: "café", category: "Eten & drinken" },
  { match: "brasserie", category: "Eten & drinken" },
  { match: "bistro", category: "Eten & drinken" },
  { match: "snackbar", category: "Eten & drinken" },
  { match: "cafetaria", category: "Eten & drinken" },
  { match: "pizzeria", category: "Eten & drinken" },
  { match: "sushi", category: "Eten & drinken" },
  // Same measured Zuid-Europese block as under Boodschappen. "restaurante",
  // "cafeteria" and "pastelaria"-with-a-cafe are already covered by the
  // "restaurant" / "cafe" entries above (plain substring matching), so only the
  // words those miss are listed.
  { match: "heladeria", category: "Eten & drinken" },
  { match: "pasteleria", category: "Eten & drinken" },
  { match: "cerveceria", category: "Eten & drinken" },
  { match: "churrasqueira", category: "Eten & drinken" },
  { match: "marisqueira", category: "Eten & drinken" },
  { match: "taberna", category: "Eten & drinken" },
  { match: "trattoria", category: "Eten & drinken" },
  { match: "osteria", category: "Eten & drinken" },
  { match: "adega", category: "Eten & drinken" },

  // --- Transport ---
  { match: "uber", category: "Transport" },
  { match: "bolt", category: "Transport" },
  { match: "ns groep", category: "Transport" },
  { match: "ns reizigers", category: "Transport" },
  { match: "ns.nl", category: "Transport" },
  { match: "ns dagkaart", category: "Transport" },
  { match: "ov-chipkaart", category: "Transport" },
  { match: "ovpay", category: "Transport" },
  { match: "ov pay", category: "Transport" },
  { match: "gvb", category: "Transport" },
  { match: "connexxion", category: "Transport" },
  { match: "arriva", category: "Transport" },
  { match: "qbuzz", category: "Transport" },
  { match: "flixbus", category: "Transport" },
  { match: "blablacar", category: "Transport" },
  { match: "greenwheels", category: "Transport" },
  { match: "mywheels", category: "Transport" },
  { match: "felyx", category: "Transport" },
  { match: "go sharing", category: "Transport" },
  { match: "donkey republic", category: "Transport" },
  { match: "swapfiets", category: "Transport" },
  { match: "shell", category: "Transport" },
  { match: "esso", category: "Transport" },
  { match: "texaco", category: "Transport" },
  { match: "tango", category: "Transport" },
  { match: "tinq", category: "Transport" },
  { match: "tamoil", category: "Transport" },
  { match: "total energies", category: "Transport" },
  { match: "q8", category: "Transport" },
  { match: "tankstation", category: "Transport" },
  { match: "benzine", category: "Transport" },
  { match: "parkeren", category: "Transport" },
  { match: "parking", category: "Transport" },
  { match: "q-park", category: "Transport" },
  { match: "qpark", category: "Transport" },
  { match: "yellowbrick", category: "Transport" },
  { match: "parkmobile", category: "Transport" },
  { match: "parkline", category: "Transport" },
  { match: "flitsmeister", category: "Transport" },
  { match: "leaseplan", category: "Transport" },
  { match: "athlon car lease", category: "Transport" },
  { match: "arval", category: "Transport" },
  { match: "ayvens", category: "Transport" },

  // --- Reizen ---
  { match: "booking.com", category: "Reizen" },
  { match: "airbnb", category: "Reizen" },
  { match: "transavia", category: "Reizen" },
  { match: "klm", category: "Reizen" },
  { match: "ryanair", category: "Reizen" },
  { match: "easyjet", category: "Reizen" },
  { match: "tui.nl", category: "Reizen" },
  { match: "tui reizen", category: "Reizen" },
  { match: "sunweb", category: "Reizen" },
  { match: "expedia", category: "Reizen" },
  { match: "eurostar", category: "Reizen" },
  { match: "thalys", category: "Reizen" },
  { match: "flixtrain", category: "Reizen" },
  { match: "schiphol", category: "Reizen" },
  { match: "hotel", category: "Reizen" },
  { match: "hostel", category: "Reizen" },
  { match: "camping", category: "Reizen" }, // measured 4x in his own card export

  // --- Entertainment ---
  { match: "netflix", category: "Entertainment" },
  { match: "videoland", category: "Entertainment" },
  { match: "disney", category: "Entertainment" },
  { match: "hbo max", category: "Entertainment" },
  { match: "hbomax", category: "Entertainment" },
  { match: "spotify", category: "Entertainment" },
  { match: "apple music", category: "Entertainment" },
  { match: "deezer", category: "Entertainment" },
  { match: "tidal", category: "Entertainment" },
  { match: "youtube", category: "Entertainment" },
  { match: "twitch", category: "Entertainment" },
  { match: "playstation", category: "Entertainment" },
  { match: "nintendo", category: "Entertainment" },
  { match: "xbox", category: "Entertainment" },
  { match: "steamgames", category: "Entertainment" },
  { match: "epic games", category: "Entertainment" },
  { match: "pathe", category: "Entertainment" },
  { match: "pathé", category: "Entertainment" },
  { match: "kinepolis", category: "Entertainment" },
  { match: "vue cinema", category: "Entertainment" },
  { match: "bioscoop", category: "Entertainment" },
  { match: "ticketmaster", category: "Entertainment" },
  { match: "eventim", category: "Entertainment" },
  { match: "paylogic", category: "Entertainment" },
  { match: "cineville", category: "Entertainment" },

  // --- Abonnementen (telecom, software/cloud, nieuws) ---
  { match: "vodafone", category: "Abonnementen" },
  { match: "ziggo", category: "Abonnementen" },
  { match: "kpn", category: "Abonnementen" },
  { match: "t-mobile", category: "Abonnementen" },
  { match: "odido", category: "Abonnementen" },
  { match: "tele2", category: "Abonnementen" },
  { match: "simyo", category: "Abonnementen" },
  { match: "lebara", category: "Abonnementen" },
  { match: "lycamobile", category: "Abonnementen" },
  { match: "hollandsnieuwe", category: "Abonnementen" },
  { match: "youfone", category: "Abonnementen" },
  { match: "ben.nl", category: "Abonnementen" },
  { match: "adobe", category: "Abonnementen" },
  { match: "dropbox", category: "Abonnementen" },
  { match: "icloud", category: "Abonnementen" },
  { match: "google one", category: "Abonnementen" },
  { match: "google storage", category: "Abonnementen" },
  { match: "linkedin", category: "Abonnementen" },
  { match: "chatgpt", category: "Abonnementen" },
  { match: "openai", category: "Abonnementen" },
  { match: "notion", category: "Abonnementen" },
  { match: "canva", category: "Abonnementen" },
  { match: "patreon", category: "Abonnementen" },
  { match: "de volkskrant", category: "Abonnementen" },
  { match: "de telegraaf", category: "Abonnementen" },
  { match: "algemeen dagblad", category: "Abonnementen" },
  { match: "dagblad trouw", category: "Abonnementen" },
  { match: "het parool", category: "Abonnementen" },
  { match: "nrc", category: "Abonnementen" },

  // --- Wonen & energie ---
  { match: "vattenfall", category: "Wonen & energie" },
  { match: "eneco", category: "Wonen & energie" },
  { match: "essent", category: "Wonen & energie" },
  { match: "greenchoice", category: "Wonen & energie" },
  { match: "vandebron", category: "Wonen & energie" },
  { match: "budget energie", category: "Wonen & energie" },
  { match: "oxxio", category: "Wonen & energie" },
  { match: "engie", category: "Wonen & energie" },
  { match: "pure energie", category: "Wonen & energie" },
  { match: "energiedirect", category: "Wonen & energie" },
  { match: "vitens", category: "Wonen & energie" },
  { match: "waternet", category: "Wonen & energie" },
  { match: "pwn", category: "Wonen & energie" },
  { match: "brabant water", category: "Wonen & energie" },
  { match: "dunea", category: "Wonen & energie" },
  { match: "evides", category: "Wonen & energie" },
  { match: "huur", category: "Wonen & energie" },
  { match: "hypotheek", category: "Wonen & energie" },
  { match: "woningcorporatie", category: "Wonen & energie" },
  { match: "vesteda", category: "Wonen & energie" },

  // --- Verzekeringen ---
  { match: "verzekering", category: "Verzekeringen" },
  { match: "zilveren kruis", category: "Verzekeringen" },
  { match: "cz zorg", category: "Verzekeringen" },
  { match: "vgz", category: "Verzekeringen" },
  { match: "menzis", category: "Verzekeringen" },
  { match: "ohra", category: "Verzekeringen" },
  { match: "unive", category: "Verzekeringen" },
  { match: "univé", category: "Verzekeringen" },
  { match: "fbto", category: "Verzekeringen" },
  { match: "ditzo", category: "Verzekeringen" },
  { match: "centraal beheer", category: "Verzekeringen" },
  { match: "nationale nederlanden", category: "Verzekeringen" },
  { match: "aegon", category: "Verzekeringen" },
  { match: "asr", category: "Verzekeringen" },
  { match: "allianz", category: "Verzekeringen" },
  { match: "interpolis", category: "Verzekeringen" },
  { match: "inshared", category: "Verzekeringen" },
  { match: "reaal", category: "Verzekeringen" },

  // --- Gezondheid (apotheek, drogist, medisch, sport) ---
  { match: "apotheek", category: "Gezondheid" },
  { match: "farmacia", category: "Gezondheid" }, // ES/PT/IT pharmacy — see the Zuid-Europese block above
  { match: "kruidvat", category: "Gezondheid" },
  { match: "etos", category: "Gezondheid" },
  { match: "trekpleister", category: "Gezondheid" },
  { match: "da drogist", category: "Gezondheid" },
  { match: "holland en barrett", category: "Gezondheid" },
  { match: "holland & barrett", category: "Gezondheid" },
  { match: "huisarts", category: "Gezondheid" },
  { match: "tandarts", category: "Gezondheid" },
  { match: "fysio", category: "Gezondheid" },
  { match: "ziekenhuis", category: "Gezondheid" },
  { match: "optiek", category: "Gezondheid" },
  { match: "hans anders", category: "Gezondheid" },
  { match: "pearle", category: "Gezondheid" },
  { match: "specsavers", category: "Gezondheid" },
  { match: "basic-fit", category: "Gezondheid" },
  { match: "basic fit", category: "Gezondheid" },
  { match: "fit for free", category: "Gezondheid" },
  { match: "sportcity", category: "Gezondheid" },
  { match: "anytime fitness", category: "Gezondheid" },
  { match: "sportschool", category: "Gezondheid" },
  { match: "fitness", category: "Gezondheid" },

  // --- Kleding & winkelen ---
  { match: "zalando", category: "Kleding & winkelen" },
  { match: "h&m", category: "Kleding & winkelen" },
  { match: "zara", category: "Kleding & winkelen" },
  { match: "primark", category: "Kleding & winkelen" },
  { match: "c&a", category: "Kleding & winkelen" },
  { match: "we fashion", category: "Kleding & winkelen" },
  { match: "wehkamp", category: "Kleding & winkelen" },
  { match: "de bijenkorf", category: "Kleding & winkelen" },
  { match: "bijenkorf", category: "Kleding & winkelen" },
  { match: "hema", category: "Kleding & winkelen" },
  { match: "action", category: "Kleding & winkelen" },
  { match: "bristol", category: "Kleding & winkelen" },
  { match: "van haren", category: "Kleding & winkelen" },
  { match: "vanharen", category: "Kleding & winkelen" },
  { match: "scapino", category: "Kleding & winkelen" },
  { match: "decathlon", category: "Kleding & winkelen" },
  { match: "intersport", category: "Kleding & winkelen" },
  { match: "perry sport", category: "Kleding & winkelen" },
  { match: "uniqlo", category: "Kleding & winkelen" },
  { match: "nike", category: "Kleding & winkelen" },
  { match: "adidas", category: "Kleding & winkelen" },
  { match: "douglas", category: "Kleding & winkelen" },
  { match: "rituals", category: "Kleding & winkelen" },
  { match: "ici paris", category: "Kleding & winkelen" },

  // --- Huis & tuin ---
  { match: "ikea", category: "Huis & tuin" },
  { match: "praxis", category: "Huis & tuin" },
  { match: "gamma", category: "Huis & tuin" },
  { match: "karwei", category: "Huis & tuin" },
  { match: "hornbach", category: "Huis & tuin" },
  { match: "intratuin", category: "Huis & tuin" },
  { match: "tuincentrum", category: "Huis & tuin" },
  { match: "leen bakker", category: "Huis & tuin" },
  { match: "kwantum", category: "Huis & tuin" },
  { match: "jysk", category: "Huis & tuin" },
  { match: "xenos", category: "Huis & tuin" },
  { match: "blokker", category: "Huis & tuin" },
  { match: "hubo", category: "Huis & tuin" },
  { match: "welkoop", category: "Huis & tuin" },

  // --- Elektronica ---
  { match: "coolblue", category: "Elektronica" },
  { match: "mediamarkt", category: "Elektronica" },
  { match: "media markt", category: "Elektronica" },
  { match: "bcc", category: "Elektronica" },
  { match: "apple store", category: "Elektronica" },

  // --- Online shopping (after amazon prime/music above) ---
  { match: "bol.com", category: "Online shopping" },
  { match: "amazon", category: "Online shopping" },
  { match: "aliexpress", category: "Online shopping" },
  { match: "marktplaats", category: "Online shopping" },
  { match: "vinted", category: "Online shopping" },
  { match: "temu", category: "Online shopping" },
  { match: "shein", category: "Online shopping" },
  { match: "etsy", category: "Online shopping" },
  { match: "ebay", category: "Online shopping" },

  // --- Belastingen & overheid ---
  { match: "belastingdienst", category: "Belastingen & overheid" },
  { match: "cjib", category: "Belastingen & overheid" },
  { match: "duo", category: "Belastingen & overheid" },
  { match: "gemeente", category: "Belastingen & overheid" },
  { match: "waterschap", category: "Belastingen & overheid" },
  { match: "cbr", category: "Belastingen & overheid" },
  { match: "rdw", category: "Belastingen & overheid" },
  { match: "svb", category: "Belastingen & overheid" },
  { match: "uwv", category: "Belastingen & overheid" },
  { match: "kvk", category: "Belastingen & overheid" },
  { match: "kamer van koophandel", category: "Belastingen & overheid" },
  { match: "loonheffing", category: "Belastingen & overheid" },
  { match: "omzetbelasting", category: "Belastingen & overheid" },
  { match: "vennootschapsbelasting", category: "Belastingen & overheid" },
  { match: "inkomstenbelasting", category: "Belastingen & overheid" },
  { match: "motorrijtuigenbelasting", category: "Belastingen & overheid" },

  // --- Sparen & beleggen ("spaarrekening" is a safe full word — bare "spar"
  //     is deliberately NOT used as it is a substring of "sparen") ---
  { match: "spaarrekening", category: "Sparen & beleggen" },
  { match: "degiro", category: "Sparen & beleggen" },
  { match: "de giro", category: "Sparen & beleggen" },
  { match: "brand new day", category: "Sparen & beleggen" },
  { match: "meesman", category: "Sparen & beleggen" },
  { match: "etoro", category: "Sparen & beleggen" },
  { match: "trade republic", category: "Sparen & beleggen" },
  { match: "scalable capital", category: "Sparen & beleggen" },
  { match: "trading 212", category: "Sparen & beleggen" },
  { match: "binance", category: "Sparen & beleggen" },
  { match: "coinbase", category: "Sparen & beleggen" },
  { match: "bitvavo", category: "Sparen & beleggen" },

  // --- Goede doelen ---
  { match: "rode kruis", category: "Goede doelen" },
  { match: "unicef", category: "Goede doelen" },
  { match: "greenpeace", category: "Goede doelen" },
  { match: "artsen zonder grenzen", category: "Goede doelen" },
  { match: "hartstichting", category: "Goede doelen" },
  { match: "cliniclowns", category: "Goede doelen" },
  { match: "oxfam", category: "Goede doelen" },
  { match: "goede doel", category: "Goede doelen" },
  { match: "donatie", category: "Goede doelen" },
  { match: "giro555", category: "Goede doelen" },

  // --- Huisdieren ---
  { match: "pets place", category: "Huisdieren" },
  { match: "petsplace", category: "Huisdieren" },
  { match: "dierenarts", category: "Huisdieren" },
  { match: "dierenkliniek", category: "Huisdieren" },
  { match: "zooplus", category: "Huisdieren" },
  { match: "dierenspeciaalzaak", category: "Huisdieren" },

  // --- Geldopname ---
  { match: "geldautomaat", category: "Geldopname" },
  { match: "geldopname", category: "Geldopname" },
  { match: "cash opname", category: "Geldopname" },
  { match: "atm", category: "Geldopname" },

  // --- Bankkosten (bank fees) ---
  { match: "kosten zakelijk betalingsverkeer", category: "Bankkosten" },
  { match: "betalingsverkeer", category: "Bankkosten" },
  { match: "betaalpakket", category: "Bankkosten" },
  { match: "bankkosten", category: "Bankkosten" },
  { match: "administratiekosten", category: "Bankkosten" },

  // --- Overboekingen (top-ups / peer transfers / card settlements — not
  //     merchant spend) ---
  { match: "geld toegevoegd", category: "Overboekingen" },
  { match: "geld toevoegen", category: "Overboekingen" },
  { match: "tikkie", category: "Overboekingen" },
  /* EEN AFBETALING AAN JE EIGEN CREDITCARD IS GEEN UITGAVE, maar een verplaatsing.
   * Zijn beslissing van 20 augustus. De echte uitgaven staan al in de app, op de
   * creditcardrekening zelf, dus de afbetaling meetellen is dubbel tellen. Daarom
   * een eigen categorie in plaats van "Overboekingen": alleen zo kan de
   * statistieklaag hem uitsluiten zonder elke andere overboeking mee te nemen. */
  { match: "naar creditcard", category: CREDIT_CARD_PAYMENT_CATEGORY },
  { match: "aflossing creditcard", category: CREDIT_CARD_PAYMENT_CATEGORY },
  { match: "incasso creditcard", category: CREDIT_CARD_PAYMENT_CATEGORY },

  // --- Inkomen. Nothing above this line can ever produce "Inkomen", so before
  //     these entries EVERY incoming transaction fell through to "onbekend" —
  //     which also meant the AI pass spent its batch on income rows instead of
  //     on the expenses Top-uitgaven shows.
  //     "salaris" is sign-gated: incoming it is the owner's pay, outgoing it is
  //     a company paying wages, and LaVega's taxonomy has no honest bucket for
  //     that — so the "out" direction is left "onbekend" rather than guessed. ---
  { match: "salaris", sign: "in", category: "Inkomen" },
  { match: "zorgtoeslag", sign: "in", category: "Inkomen" },
  { match: "huurtoeslag", sign: "in", category: "Inkomen" },
  { match: "kinderbijslag", sign: "in", category: "Inkomen" },
];

/* ISO-3166 alpha-3 country codes as Dutch card exports print them. ING's
 * creditcard CSV and MT940 both end a card descriptor with the merchant's
 * country ("MERCADONA VALENCIA ESP"), which is how LaVega can tell a foreign
 * payment from a domestic one WITHOUT asking anyone anything — the fact is
 * already in the row we imported.
 *
 * This is NOT a category and must never become one. A payment abroad is a
 * circumstance, not a kind of spending: the measured rows are groceries, bars
 * and campsites. The set exists so an "onbekend" row can say WHY it is unknown
 * (see unknownReason in categorize.ts) instead of leaving the owner to guess.
 *
 * Three deliberate choices:
 *   1. NLD is absent — a domestic payment is the normal case, not a signal.
 *   2. Codes that are also ordinary words in Dutch, English, Spanish,
 *      Portuguese, German or French are LEFT OUT even though they are valid
 *      ISO codes: CAN, PER, MAR, CHE, IND, COL, ARE, SEN, ARM, AND, ALB, ISL,
 *      LAO, MLI, TON. A probe over every transaction in the owner's exports
 *      found zero legitimate uses of them, so their only possible effect was a
 *      false "buitenland" label.
 *   3. Matching is on a STANDALONE, UPPERCASE token. Exports print the code in
 *      caps; requiring caps is what keeps "esp" inside a lowercase word from
 *      firing, and requiring a whole token is what keeps "ITA" out of
 *      "CAPITAL". */
export const FOREIGN_COUNTRY_CODES: ReadonlySet<string> = new Set([
  // Europe
  "ESP",
  "PRT",
  "FRA",
  "DEU",
  "BEL",
  "LUX",
  "GBR",
  "IRL",
  "AUT",
  "ITA",
  "GRC",
  "DNK",
  "SWE",
  "NOR",
  "FIN",
  "POL",
  "CZE",
  "SVK",
  "HUN",
  "ROU",
  "BGR",
  "HRV",
  "SVN",
  "SRB",
  "MNE",
  "MKD",
  "BIH",
  "EST",
  "LVA",
  "LTU",
  "CYP",
  "MLT",
  "UKR",
  "TUR",
  "GEO",
  "MCO",
  "SMR",
  "LIE",
  "GIB",
  "FRO",
  "GRL",
  // Africa & Middle East. Morocco (MAR) and Switzerland (CHE) are deliberately
  // unreachable here: both codes are ordinary words, and a false "buitenland" on
  // a domestic row is worse than no label at all. A card row from either country
  // simply reads "geen regel" instead — still honest, just less specific.
  "TUN",
  "DZA",
  "EGY",
  "ZAF",
  "KEN",
  "TZA",
  "GHA",
  "NGA",
  "ISR",
  "JOR",
  "LBN",
  "SAU",
  "QAT",
  "OMN",
  "KWT",
  "BHR",
  // Americas
  "USA",
  "MEX",
  "BRA",
  "ARG",
  "CHL",
  "URY",
  "PAN",
  "CRI",
  "DOM",
  "CUB",
  "JAM",
  "PRI",
  "BRB",
  "BHS",
  // Asia & Oceania
  "JPN",
  "KOR",
  "CHN",
  "TWN",
  "HKG",
  "SGP",
  "THA",
  "IDN",
  "VNM",
  "PHL",
  "MYS",
  "LKA",
  "NPL",
  "AUS",
  "NZL",
  "FJI",
]);

/** The ISO-3166 alpha-3 country code a card export printed on this row, or null.
 *  Only a STANDALONE, UPPERCASE token counts, and NLD never does.
 *
 *  It lives HERE, beside the curated set, because both categorize.ts and views.ts
 *  need it and views.ts cannot import from categorize.ts — categorize.ts already
 *  imports from views.ts. Two copies of a curated matcher is how the curation
 *  drifts out of one of them. */
export function foreignCodeIn(text: string): string | null {
  for (const w of text.split(/[^A-Za-z]+/)) {
    if (w.length !== 3) continue;
    if (w !== w.toUpperCase()) continue; // exports print the code in caps
    if (FOREIGN_COUNTRY_CODES.has(w)) return w;
  }
  return null;
}

/* Pre-normalized once at module load so categorize() does a plain substring test
 * per entry (no per-transaction matchNorm of the match strings). `sign` is
 * carried through so categorize() can skip a direction-specific entry. */
export const NL_CATEGORY_RULES_NORMALIZED: ReadonlyArray<{
  m: string;
  category: string;
  sign?: "in" | "out";
  weak?: true;
}> = NL_CATEGORY_RULES.map((r) => ({
  m: matchNorm(r.match),
  category: r.category,
  ...(r.sign ? { sign: r.sign } : {}),
  ...(r.weak ? { weak: r.weak } : {}),
}));

/* ══════════════════════════════════════════════════════════════════════════
 * WHO THE COUNTERPARTY IS — a person, a collection, or the owner himself.
 *
 * App review 20-08-2026, item 6. Three readings he described precisely, and all
 * three are LAST-RESORT readings: they only speak where a manual label, an
 * own-account match, a user rule and every built-in merchant default have all
 * stayed silent. That order is the entire safety argument, because "Albert
 * Heijn" is two Titlecase words and would pass the person-name shape test — the
 * person rule may never be allowed to see a row a merchant rule can place.
 *
 * The asymmetry that shapes every choice below: a SHOP called a person sends
 * real spending into a person-to-person bucket, which silently distorts a total
 * he reads; a PERSON left unrecognised only stays "onbekend", which is honest
 * and which he can fix with one rule. So every doubt is resolved against
 * "person" — the vetoes are generous on purpose.
 * ═══════════════════════════════════════════════════════════════════════ */

/** A booking from one person to another. Deliberately NOT "Overboekingen": he
 *  was explicit that money moving between two people is its own thing, and
 *  "Overboekingen" is where a bank's own product wording ends up. */
export const PERSON_CATEGORY = "Tussen personen";

/** A SEPA direct debit whose merchant no rule knows. Not "the kind of spending"
 *  — the mechanism, which is the only thing the row proves. */
export const DIRECT_DEBIT_CATEGORY = "Automatische incasso";

/** Just enough of a transaction to read its text. A structural type, so this
 *  lexicon module stays free of the model (and of any import cycle). */
export type TxText = { counterparty: string; description: string };

const deaccent = (s: string): string => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/* Titles Dutch, French and English exports print in front of a name. They are
 * dropped before the shape is read, and their PRESENCE is itself evidence — a
 * row that says "Hr" is about a person. */
const HONORIFICS: ReadonlySet<string> = new Set([
  "hr",
  "dhr",
  "mr",
  "mw",
  "mevr",
  "mev",
  "mej",
  "fam",
  "familie",
  "mme",
  "mlle",
  "mle",
  "miss",
  "mrs",
  "ms",
  "sr",
  "sra",
  "srta",
  "dr",
  "prof",
  "ir",
  "ing",
  "drs",
  "mgr",
]);

/* Tussenvoegsels — the unstressed particles inside a Dutch/European surname,
 * including the abbreviations ING prints ("Hr J v d Fliert"). Two jobs: they
 * must not be counted as name words, and a part that STARTS with one is refused
 * outright ("De Smitse", "Le Chocolat" are businesses, and a surname-first
 * export beginning with a particle is rare enough to give up rather than risk). */
const TUSSENVOEGSELS: ReadonlySet<string> = new Set([
  "van",
  "von",
  "de",
  "den",
  "der",
  "des",
  "del",
  "della",
  "di",
  "da",
  "das",
  "dos",
  "do",
  "du",
  "la",
  "le",
  "les",
  "el",
  "al",
  "ten",
  "ter",
  "te",
  "tot",
  "op",
  "in",
  "uit",
  "bin",
  "ibn",
  "bint",
  "abu",
  "'t",
  "’t",
  "t",
  "v",
  "d",
  "vd",
  "vander",
  "y",
  "e",
  "af",
  "av",
  "zu",
]);

/* Words that appear in the name of a business, an institution or a bank's own
 * product, and never in a person's name. Membership is tested on a whole token
 * (dots and commas stripped), so "bar" cannot fire inside "Barbara".
 *
 * The list is long because a veto is CHEAP — it only ever costs a person row a
 * category it would otherwise have got — while a missing veto is what puts a
 * shop in the person bucket. Two-letter legal forms that double as initials
 * ("SA", "AS", "AB", "AG", "CV") are deliberately absent: "AS Terjesen" is a
 * person, and those forms are rare in a Dutch export. */
const COMPANY_WORDS: ReadonlySet<string> = new Set([
  // legal forms
  "bv",
  "nv",
  "vof",
  "gmbh",
  "ug",
  "ltd",
  "limited",
  "llp",
  "llc",
  "inc",
  "plc",
  "srl",
  "sarl",
  "sprl",
  "sl",
  "spa",
  "oyj",
  "kft",
  "zoo",
  "ev",
  // organisation shapes
  "stichting",
  "stg",
  "foundation",
  "fonds",
  "fund",
  "charity",
  "vereniging",
  "cooperatie",
  "cooperatief",
  "maatschap",
  "holding",
  "groep",
  "group",
  "partners",
  "associates",
  "ventures",
  "capital",
  "invest",
  "investments",
  "beheer",
  "vastgoed",
  "makelaardij",
  "makelaars",
  "notariaat",
  "notaris",
  "advocaten",
  "advocatenkantoor",
  "adviseurs",
  "advies",
  "accountants",
  "administratie",
  "consultancy",
  "consulting",
  "agency",
  "bureau",
  "kantoor",
  "dienst",
  "diensten",
  "services",
  "service",
  "solutions",
  "systems",
  "technology",
  "technologies",
  "software",
  "digital",
  "media",
  "labs",
  "studio",
  "works",
  "verhuur",
  "transport",
  "logistiek",
  "techniek",
  "installatie",
  "schoonmaak",
  "catering",
  "horeca",
  "bakkerij",
  "slagerij",
  "apotheek",
  "kliniek",
  "praktijk",
  "fysio",
  "tandarts",
  "huisarts",
  "verzekeringen",
  "verzekering",
  "belastingdienst",
  "gemeente",
  "provincie",
  "waterschap",
  "ministerie",
  "politie",
  "rechtbank",
  "cjib",
  "school",
  "college",
  "academie",
  "universiteit",
  "university",
  "hogeschool",
  "students",
  "student",
  "education",
  "development",
  "entrepreneurship",
  "international",
  "nederland",
  "netherlands",
  "europe",
  "europa",
  "holland",
  "abroad",
  "centre",
  "center",
  "institute",
  "instituut",
  "association",
  "society",
  "union",
  "council",
  "trust",
  "network",
  "platform",
  "community",
  "collective",
  "committee",
  "federation",
  "academy",
  "campus",
  "faculty",
  // places money is spent, where a two-word Titlecase name is common
  "museum",
  "theater",
  "bioscoop",
  "hotel",
  "hostel",
  "camping",
  "restaurant",
  "cafe",
  "bar",
  "lounge",
  "brasserie",
  "eetcafe",
  "pizzeria",
  "snackbar",
  "supermarkt",
  "markt",
  "winkel",
  "shop",
  "store",
  "boutique",
  "salon",
  "kapper",
  "sport",
  "sports",
  "fitness",
  "gym",
  "club",
  "team",
  "business",
  "life",
  "air",
  "airlines",
  "airways",
  "aviation",
  "travel",
  "tours",
  "resort",
  "rental",
  "express",
  "tankstation",
  "garage",
  // a bank's own wording for its products and its bookkeeping
  "rekening",
  "spaarrekening",
  "betaalrekening",
  "creditcard",
  "incasso",
  "machtiging",
  "aflossing",
  "rente",
  "kaartbijdrage",
  "betaling",
  "betalingsverkeer",
  "betaalverzoek",
  "tikkie",
  "kosten",
  "zakelijk",
  "verzamelbetaling",
  "opname",
  "transactie",
  "reference",
  "factuur",
  "abonnement",
  "contributie",
  "payments",
  "payment",
  "checkout",
  "invoice",
  "toeslag",
  "uitkering",
  "salaris",
  "bank",
  "bankgiro",
  "giro",
]);

/* Endings that make a compound a business or a product even when the compound
 * itself is not listed: "Debiteurenadministratie", "Bedrijfsrekening",
 * "Incassobureau", "Bankkosten", "Belastingadviseurs". Required to be a strict
 * suffix (longer than the ending) so the whole-word list keeps doing that job. */
const COMPANY_SUFFIXES: readonly string[] = [
  "rekening",
  "administratie",
  "kantoor",
  "bureau",
  "dienst",
  "diensten",
  "kosten",
  "adviseurs",
  "advocaten",
  "accountants",
  "verzekeringen",
  "bedrijf",
  "winkel",
  "markt",
  "bank",
  "groep",
  "verhuur",
  "beheer",
];

/* What a bank writes IN FRONT of a name, in either language: Revolut's "To A
 * Steunenberg" / "Overschrijving van ELISA …", ING's "Betaling …". They are
 * dropped like a title is — and so is one following connector ("van", "naar",
 * "from"), because "van" at the start of what is left would otherwise be read
 * as a tussenvoegsel and refuse the whole name. */
const LEAD_PREFIXES: ReadonlySet<string> = new Set([
  "to",
  "from",
  "payment",
  "transfer",
  "sent",
  "received",
  "naar",
  "aan",
  "voor",
  "betaling",
  "overboeking",
  "overschrijving",
  "storting",
]);
const LEAD_CONNECTORS: ReadonlySet<string> = new Set([
  "van",
  "naar",
  "to",
  "from",
  "aan",
  "door",
  "by",
]);

const isCompanyWord = (token: string): boolean => {
  const w = deaccent(token).toLowerCase().replace(/[.,]/g, "");
  if (!w) return false;
  if (COMPANY_WORDS.has(w)) return true;
  return COMPANY_SUFFIXES.some((s) => w.length > s.length && w.endsWith(s));
};

/** Split a glued "A.Steunenberg" into its initials and its word, and leave
 *  everything else alone. Some exports drop the space after an initial. */
function splitGlued(token: string): string[] {
  const m = /^((?:[A-Za-z]\.)+)([A-Za-z]{2,})$/.exec(token);
  return m ? [m[1], m[2]] : [token];
}

/** "NXCHANGE B V" and "Jansen B.V." are the same legal form spelled two ways,
 *  and the spaced one tokenizes into two innocent-looking initials. Collapsed
 *  before anything else looks at it. The cost is a person whose initials happen
 *  to be B V — a name we then leave alone, which is the safe direction. */
const collapseLegalForm = (part: string): string =>
  part.replace(/(^|\s)([bn])\.?\s*([vw])\.?(?=\s|$)/gi, (_m, lead, a, b) => `${lead}${a}${b}`);

const tokensOf = (part: string): string[] =>
  collapseLegalForm(part).trim().split(/\s+/).filter(Boolean).flatMap(splitGlued);

type TokenKind = "honorific" | "tussenvoegsel" | "initials" | "word" | "junk";

/** What a single token can be inside a person's name.
 *
 *  Case is load-bearing, and it is the rule that keeps Dutch prose out: a name
 *  word must START WITH A CAPITAL, so "Betaling aan leverancier" is refused on
 *  "aan" and "leverancier" without needing a dictionary of Dutch words.
 *
 *  A short ALL-CAPS token is ambiguous — "JAJ" is initials, "CHEN" is a surname
 *  — and it is resolved by vowels: a 2-4 letter caps token with no vowel is
 *  read as initials, otherwise as a name word. Either reading leads to the same
 *  verdict for every shape we have seen; the distinction only matters for the
 *  "one name word needs supporting evidence" test below. */
function kindOf(token: string): TokenKind {
  const t = deaccent(token);
  const bare = t.replace(/[.,]/g, "").toLowerCase();
  if (!bare) return "junk";
  if (HONORIFICS.has(bare)) return "honorific";
  // A single letter is a tussenvoegsel abbreviation only in lower case ("v d"),
  // otherwise it is an initial ("V Ciumac").
  if (TUSSENVOEGSELS.has(bare) && (bare.length > 1 || t === t.toLowerCase()))
    return "tussenvoegsel";
  if (/^(?:[A-Za-z]\.)+$/.test(t) || /^[A-Za-z]$/.test(t)) return "initials";
  if (/^[A-Z]{2,4}$/.test(t) && !/[AEIOUY]/.test(t)) return "initials";
  if (/^[A-Z][A-Za-z'’-]*$/.test(t) && t.length >= 2) return "word";
  return "junk";
}

/* A name can arrive with two people in it ("A,B", "A en/of B", "A und B") or
 * with the mechanism glued on ("X via Rabo Betaalverzoek"). Each part is judged
 * on its own and ONE person is enough — the vetoes are applied per part, which
 * is what lets "via Rabo Betaalverzoek" be refused while the name is accepted. */
const splitNameParts = (raw: string): string[] =>
  raw.split(/,|&|\s+en\/of\s+|\s+e\/o\s+|\s+und\s+|\s+via\s+/i);

function partIsPerson(part: string): boolean {
  const tokens = tokensOf(part);
  if (!tokens.length) return false;
  if (tokens.some(isCompanyWord)) return false;
  let i = 0;
  let stripped = false;
  let hadHonorific = false;
  while (i < tokens.length) {
    const bare = deaccent(tokens[i]).replace(/[.,]/g, "").toLowerCase();
    if (HONORIFICS.has(bare)) {
      i++;
      stripped = true;
      hadHonorific = true;
      continue;
    }
    if (LEAD_PREFIXES.has(bare)) {
      i++;
      stripped = true;
      continue;
    }
    if (stripped && LEAD_CONNECTORS.has(bare) && i + 1 < tokens.length) {
      i++;
      continue;
    }
    break;
  }
  const rest = tokens.slice(i);
  if (!rest.length) return false;
  if (kindOf(rest[0]) === "tussenvoegsel") return false;
  let words = 0;
  let initials = 0;
  for (const t of rest) {
    const k = kindOf(t);
    if (k === "word") words++;
    else if (k === "initials") initials++;
    else if (k === "tussenvoegsel") continue;
    else return false; // junk, or a second honorific mid-name: not a name we can read
  }
  // One name word on its own is a shop ("Coolblue", "Vitam"). It becomes a
  // person only with supporting evidence: an initial or a title in front of it.
  if (words === 0 || words > 5) return false;
  if (words === 1 && initials === 0 && !hadHonorific) return false;
  return true;
}

/** Whether a counterparty string is another person's NAME.
 *
 *  Reads the counterparty only — the description of a person's transfer is free
 *  text ("Expense reimbursement", "monthly volunteer fee") and adding it would
 *  only add ways to be wrong.
 *
 *  Known limitation, measured on his own exports: a firm named after the people
 *  who founded it ("Witlox van den Boomen", an accountancy) is indistinguishable
 *  from a person and lands here. A user rule fixes it, and a rule outranks this
 *  reading. */
export function isPersonName(counterparty: string): boolean {
  const raw = (counterparty ?? "").trim();
  if (!raw || raw.length > 70) return false;
  // A digit anywhere means a shop number, a card number or a reference — never
  // a name. This one veto removes most card and iDEAL rows on its own.
  if (/\d/.test(raw)) return false;
  if (/[@]|www\.|https?:/i.test(raw)) return false;
  if (/[:;=<>|#*+()[\]{}%$€]/.test(raw)) return false;
  // A country token means a card descriptor ("MERCADONA ... VALENCIA ESP"), and
  // NLD counts here even though it is never a "foreign" signal elsewhere.
  if (foreignCodeIn(raw) || /\bNLD\b/.test(raw)) return false;
  return splitNameParts(raw).some(partIsPerson);
}

/** True when the row was paid at a physical terminal or cash machine. Reads the
 *  whole row, not just the name. */
export function isCardPayment(text: string): boolean {
  return /kaartnr|kaartnummer|pasvolgnr|\bterm\b|\bterm:|betaalautomaat|geldautomaat|\bbea\b|\bgea\b|apple\s*pay|google\s*pay|contactloos/i.test(
    text,
  );
}

/** True when the ROW carries the marks of a card payment at a MERCHANT: a card
 *  or terminal number, or the country token a card descriptor ends with
 *  ("TIENDA J LOPEZ" + "VALENCIA ESP"). Such a row is a purchase, whatever the
 *  shop happens to be called — so it can never be a booking between two people.
 *
 *  This has to read the whole row and not just the name: the country lives in
 *  the memo, and a Spanish shop called "TIENDA J LOPEZ" passes the person-name
 *  shape test on its own. NLD counts here, unlike everywhere else — at this one
 *  spot a domestic card descriptor is exactly as disqualifying as a foreign one. */
export function isMerchantRow(text: string): boolean {
  return isCardPayment(text) || foreignCodeIn(text) !== null || /\bNLD\b/.test(text);
}

/* ── An incasso, read off the row's own code ─────────────────────────────── */

export type DirectDebit = {
  /** The mandate the collection ran on ("Machtiging ID", Rabo's
   *  "Machtigingskenmerk"), or null when the row only says it is a collection. */
  machtigingId: string | null;
  /** The creditor's SEPA identifier ("Incassant ID"), or null. */
  incassantId: string | null;
};

/* ING prints "Machtiging ID: … Incassant ID: … Doorlopende incasso" on an
 * incasso row; Rabobank has "Machtigingskenmerk" and "Incassant ID" columns;
 * ABN's MT940 descriptor reads "SEPA Incasso algemeen doorlopend … Incassant:".
 * The bare WORD "incasso" is deliberately NOT enough: "Centraal Justitieel
 * Incasso Bureau" is a debt collector and ING's own "Incasso ING creditcard" is
 * a credit-card settlement. A code, or the SEPA phrase — nothing looser. */
const MACHTIGING_RE = /machtiging(?:s?kenmerk)?(?:\s*id)?\s*[:#]\s*([^\s;]+)/i;
const INCASSANT_RE = /incassant(?:\s*id)?\s*[:#]\s*([^\s;]+)/i;
const SEPA_INCASSO_RE =
  /\b(?:doorlopend|doorlopende|eenmalig|eenmalige)\s+(?:sepa\s+)?incasso\b|\bsepa\s+incasso\b|\bsepa\s+direct\s*debit\b/i;

/** The mandate and creditor identifiers of a SEPA direct debit, or null when
 *  this row is not one. Evidence, not a guess: every branch is a code or a
 *  phrase the bank itself printed. */
export function directDebit(tx: TxText): DirectDebit | null {
  const raw = `${tx.counterparty} ${tx.description}`;
  const m = MACHTIGING_RE.exec(raw);
  const i = INCASSANT_RE.exec(raw);
  if (!m && !i && !SEPA_INCASSO_RE.test(raw)) return null;
  return { machtigingId: m ? m[1] : null, incassantId: i ? i[1] : null };
}

/* ── His own name ───────────────────────────────────────────────────────────
 *
 * USER DATA. The app does not know the owner's name, and it must never guess
 * one: everything here takes a name that was GIVEN to it (see parseOwnName) and
 * refuses to match when none was. The UI supplies it; core only decides whether
 * a counterparty is that name. */

export type OwnName = {
  /** Lower-cased surname including its tussenvoegsels ("van der meer"). */
  surname: string;
  /** Lower-cased given names in order, as far as they were supplied. */
  given: string[];
};

/** Read a name the owner typed into a surname + given names. Returns null for
 *  anything unusable (empty, one letter, punctuation) — no name, no matching. */
export function parseOwnName(fullName: string): OwnName | null {
  const tokens = tokensOf(deaccent(fullName ?? "").toLowerCase())
    .map((t) => t.replace(/[.,]/g, ""))
    .filter((t) => /^[a-z'’-]+$/.test(t) && !HONORIFICS.has(t));
  if (tokens.length === 0) return null;
  // The surname starts at the first tussenvoegsel that still has a word behind
  // it ("jan van der meer" -> "van der meer"); otherwise it is the last token.
  let start = tokens.length - 1;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (TUSSENVOEGSELS.has(tokens[i])) {
      start = i;
      break;
    }
  }
  const surnameParts = tokens.slice(start);
  const last = surnameParts[surnameParts.length - 1];
  if (!last || last.length < 2) return null;
  return { surname: surnameParts.join(" "), given: tokens.slice(0, start) };
}

/** Whether a counterparty is one of the owner's OWN names — surname alone,
 *  initial(s) plus surname, or the full name, in either order and with or
 *  without a title. Anything that contradicts what he told us is somebody else:
 *  "B Steunenberg" and "Nadia Lina Steunenberg" are relatives, not him.
 *
 *  Initials are compared position by position over their common length, so an
 *  export that prints MORE initials than he gave us ("AB Steunenberg" when we
 *  know "Alexander") still matches, while a different first initial never does. */
export function isOwnName(counterparty: string, names?: readonly OwnName[]): boolean {
  if (!names || names.length === 0) return false;
  const raw = (counterparty ?? "").trim();
  if (!raw || /\d/.test(raw)) return false;
  for (const part of splitNameParts(raw)) {
    const tokens = tokensOf(part);
    if (!tokens.length || tokens.some(isCompanyWord)) continue;
    const plain = tokens
      .map((t) => deaccent(t).replace(/[.,]/g, ""))
      .filter((t) => /^[A-Za-z'’-]+$/.test(t));
    if (plain.length !== tokens.length) continue; // junk in the part: not a name
    const lower = plain.map((t) => t.toLowerCase());
    for (const name of names) {
      const surname = name.surname.split(" ");
      const at = indexOfSequence(lower, surname);
      if (at < 0) continue;
      const rest = [...plain.slice(0, at), ...plain.slice(at + surname.length)].filter((t) => {
        const b = t.toLowerCase();
        return !HONORIFICS.has(b) && !LEAD_PREFIXES.has(b) && !LEAD_CONNECTORS.has(b);
      });
      if (rest.length === 0) return true; // the bare surname, which he named himself
      if (restMatchesGiven(rest, name.given)) return true;
    }
  }
  return false;
}

const indexOfSequence = (hay: string[], needle: string[]): number => {
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++)
      if (hay[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    if (ok) return i;
  }
  return -1;
};

/** Do the tokens around the surname agree with the given names we were told?
 *
 *  A token that IS one of his given names agrees. A token of five letters or
 *  more that is not one of them is somebody else's first name, and disagrees.
 *  Everything shorter is read as initials and compared letter by letter over
 *  the length the two sides share, so "A" and "AB" both agree with "Alexander"
 *  while "B" and "NL" never do.
 *
 *  With no given name on file there is nothing to compare an initial against,
 *  and "A Steunenberg" is then refused rather than guessed — which is why the
 *  UI has to ask for a FULL name and not only a surname. */
function restMatchesGiven(rest: string[], given: readonly string[]): boolean {
  const known = given.map((g) => g[0]);
  const initials: string[] = [];
  for (const t of rest) {
    const w = t.toLowerCase();
    if (given.includes(w)) continue; // a given name, written out
    if (w.length >= 5) return false; // someone else's first name
    initials.push(...w.replace(/[^a-z]/g, "").split(""));
  }
  if (initials.length === 0) return true;
  if (known.length === 0) return false; // an initial we cannot check is not a match
  for (let i = 0; i < Math.min(initials.length, known.length); i++) {
    if (initials[i] !== known[i]) return false;
  }
  return true;
}
