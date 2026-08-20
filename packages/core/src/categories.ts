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

export type CategoryRule = { match: string; category: string; sign?: "in" | "out" };

export const NL_CATEGORY_RULES: readonly CategoryRule[] = [
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
  { match: "naar creditcard", category: "Overboekingen" },

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
  "ESP", "PRT", "FRA", "DEU", "BEL", "LUX", "GBR", "IRL", "AUT", "ITA", "GRC",
  "DNK", "SWE", "NOR", "FIN", "POL", "CZE", "SVK", "HUN", "ROU", "BGR", "HRV",
  "SVN", "SRB", "MNE", "MKD", "BIH", "EST", "LVA", "LTU", "CYP", "MLT", "UKR",
  "TUR", "GEO", "MCO", "SMR", "LIE", "GIB", "FRO", "GRL",
  // Africa & Middle East. Morocco (MAR) and Switzerland (CHE) are deliberately
  // unreachable here: both codes are ordinary words, and a false "buitenland" on
  // a domestic row is worse than no label at all. A card row from either country
  // simply reads "geen regel" instead — still honest, just less specific.
  "TUN", "DZA", "EGY", "ZAF", "KEN", "TZA", "GHA", "NGA", "ISR", "JOR",
  "LBN", "SAU", "QAT", "OMN", "KWT", "BHR",
  // Americas
  "USA", "MEX", "BRA", "ARG", "CHL", "URY", "PAN", "CRI", "DOM", "CUB", "JAM",
  "PRI", "BRB", "BHS",
  // Asia & Oceania
  "JPN", "KOR", "CHN", "TWN", "HKG", "SGP", "THA", "IDN", "VNM", "PHL", "MYS",
  "LKA", "NPL", "AUS", "NZL", "FJI",
]);

/* Pre-normalized once at module load so categorize() does a plain substring test
 * per entry (no per-transaction matchNorm of the match strings). `sign` is
 * carried through so categorize() can skip a direction-specific entry. */
export const NL_CATEGORY_RULES_NORMALIZED: ReadonlyArray<{ m: string; category: string; sign?: "in" | "out" }> =
  NL_CATEGORY_RULES.map((r) => (r.sign
    ? { m: matchNorm(r.match), category: r.category, sign: r.sign }
    : { m: matchNorm(r.match), category: r.category }));
