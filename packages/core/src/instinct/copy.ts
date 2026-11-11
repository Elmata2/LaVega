import type { TipId } from "./tips.js";

/* Every word the daily message can say, NL and EN. Templates take only
 * already formatted figures (money, dates, counts, names) and add words around
 * them; nothing else is interpolated. Push text (`short`) stays under 120
 * characters with the longest realistic figures. No hyphens inside sentences. */

export type MessageLocale = "nl" | "en";

type Text = { title: string; short: string; long: string };

export type InstinctCopy = {
  weekdays: readonly [string, string, string, string, string, string, string];
  spending: (f: { yesterday: string; diff: string; more: boolean; weekday: string }) => Text;
  renewal: (f: { name: string; when: string; amount: string | null }) => Text;
  dueDate: (f: { name: string; when: string; date: string }) => Text;
  rateOffer: (f: { name: string; gain: string }) => Text;
  cardOffer: (f: { name: string; gain: string }) => Text;
  /** "vandaag" / "morgen" / "over 5 dagen" */
  when: (daysAway: number) => string;
  tips: Record<TipId, Text>;
  consentReminder: Text;
  pausedNotice: Text;
  /** Sentences for the read-only answer tools (tools.ts). Every argument is an
   *  already formatted figure, name or date. */
  tools: {
    spendingOnDay: (f: { date: string; amount: string }) => string;
    spendingInRange: (f: {
      from: string;
      to: string;
      amount: string;
      category: string | null;
    }) => string;
    compare: (f: {
      date: string;
      amount: string;
      lastDate: string;
      lastAmount: string;
      diff: string;
      direction: "more" | "less" | "same";
      weekday: string;
    }) => string;
    upcomingNone: (f: { days: number }) => string;
    upcomingItem: (f: { name: string; amount: string; date: string }) => string;
    upcomingTotal: (f: { amount: string; days: number }) => string;
    upcomingMore: (f: { more: number }) => string;
    topNone: (f: { from: string; to: string }) => string;
    topItem: (f: { category: string; amount: string }) => string;
    /** Said when the question reaches beyond the data LaVega holds. */
    coverage: (f: { from: string; to: string }) => string;
    outsideWindow: (f: { from: string; to: string }) => string;
  };
};

export const INSTINCT_COPY: Record<MessageLocale, InstinctCopy> = {
  nl: {
    weekdays: ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"],
    spending: (f) => ({
      title: "Uitgaven van gisteren",
      short: `Je gaf gisteren ${f.yesterday} uit, ${f.diff} ${f.more ? "meer" : "minder"} dan vorige ${f.weekday}.`,
      long: `Je gaf gisteren ${f.yesterday} uit, ${f.diff} ${f.more ? "meer" : "minder"} dan vorige ${f.weekday}. Bekijk in LaVega waar dat naartoe ging.`,
    }),
    renewal: (f) => ({
      title: "Abonnement wordt verlengd",
      short: `${f.name} wordt ${f.when} verlengd${f.amount === null ? "" : `, ${f.amount}`}.`,
      long: `${f.name} wordt ${f.when} verlengd${f.amount === null ? "" : ` voor ${f.amount}`}. Zeg het op tijd op als je het niet meer gebruikt.`,
    }),
    dueDate: (f) => ({
      title: "Datum in zicht",
      short: `${f.name} is ${f.when} aan de beurt, op ${f.date}.`,
      long: `${f.name} is ${f.when} aan de beurt, op ${f.date}. Zorg dat het geld op tijd klaarstaat.`,
    }),
    rateOffer: (f) => ({
      title: "Meer rente mogelijk",
      short: `Bij ${f.name} krijg je naar schatting ${f.gain} per jaar meer rente over je spaargeld.`,
      long: `Bij ${f.name} krijg je naar schatting ${f.gain} per jaar meer rente over je spaargeld dan nu. Bekijk de vergelijking bij Optimalisatie.`,
    }),
    cardOffer: (f) => ({
      title: "Voordeliger betaalpas of creditcard",
      short: `Met ${f.name} houd je op basis van je uitgaven naar schatting ${f.gain} per jaar over.`,
      long: `Met ${f.name} houd je op basis van je uitgaven naar schatting ${f.gain} per jaar over ten opzichte van je huidige kaart. Bekijk de vergelijking bij Optimalisatie.`,
    }),
    when: (n) => (n === 0 ? "vandaag" : n === 1 ? "morgen" : `over ${n} dagen`),
    tips: {
      "subscription-overlap": {
        title: "Dubbele abonnementen",
        short: "Je hebt abonnementen die hetzelfde doen. Kijk of je er één kunt opzeggen.",
        long: "Je hebt abonnementen die hetzelfde doen. Open Abonnementen in LaVega en kijk of je er één kunt opzeggen.",
      },
      "price-increase": {
        title: "Duurder abonnement",
        short: "Een van je abonnementen is duurder geworden. Is het die prijs nog waard?",
        long: "Een van je abonnementen is duurder geworden. Open Abonnementen in LaVega en kijk of het die prijs nog waard is.",
      },
      "many-subscriptions": {
        title: "Veel abonnementen",
        short: "Je hebt veel lopende abonnementen. Loop ze langs en houd wat je echt gebruikt.",
        long: "Je hebt veel lopende abonnementen. Open Abonnementen in LaVega, loop ze langs en houd wat je echt gebruikt.",
      },
      "idle-balance": {
        title: "Veel geld op je betaalrekening",
        short: "Er staat veel op je betaalrekening. Vergelijk wat een spaarrekening oplevert.",
        long: "Er staat veel op je betaalrekening. Vergelijk bij Optimalisatie in LaVega wat een spaarrekening met gratis opname oplevert.",
      },
      "fee-heavy-account": {
        title: "Bankkosten",
        short: "Je betaalde de laatste maanden bankkosten. Vergelijk wat andere rekeningen kosten.",
        long: "Je betaalde de laatste maanden bankkosten. Open Rekeningen in LaVega en vergelijk wat andere rekeningen kosten.",
      },
    },
    consentReminder: {
      title: "Koppel je bank opnieuw",
      short: "Je bankkoppeling verloopt binnenkort. Koppel je bank opnieuw om meldingen te houden.",
      long: "Je bankkoppeling verloopt binnenkort. Koppel je bank opnieuw in LaVega, dan blijf je meldingen krijgen.",
    },
    pausedNotice: {
      title: "Meldingen gepauzeerd",
      short:
        "Je meldingen staan op pauze, want je bankkoppeling is verlopen. Koppel je bank opnieuw.",
      long: "Je meldingen staan op pauze, want je bankkoppeling is verlopen. Koppel je bank opnieuw in LaVega om ze te hervatten.",
    },
    tools: {
      spendingOnDay: (f) => `Op ${f.date} gaf je ${f.amount} uit.`,
      spendingInRange: (f) =>
        `Van ${f.from} tot en met ${f.to} gaf je ${f.amount} uit${f.category === null ? "" : ` aan ${f.category}`}.`,
      compare: (f) =>
        f.direction === "same"
          ? `Op ${f.date} gaf je ${f.amount} uit, evenveel als vorige ${f.weekday} (${f.lastDate}).`
          : `Op ${f.date} gaf je ${f.amount} uit, ${f.diff} ${f.direction === "more" ? "meer" : "minder"} dan vorige ${f.weekday} (${f.lastDate}, ${f.lastAmount}).`,
      upcomingNone: (f) => `Er komen de volgende ${f.days} dagen geen vaste afschrijvingen aan.`,
      upcomingItem: (f) => `${f.name}: ${f.amount} op ${f.date}.`,
      upcomingMore: (f) => `Nog ${f.more} andere afschrijvingen staan niet in de lijst.`,
      upcomingTotal: (f) => `Samen ${f.amount} in de komende ${f.days} dagen.`,
      topNone: (f) => `Van ${f.from} tot en met ${f.to} zijn er geen uitgaven.`,
      topItem: (f) => `${f.category}: ${f.amount}.`,
      coverage: (f) => `LaVega heeft alleen gegevens van ${f.from} tot en met ${f.to}.`,
      outsideWindow: (f) =>
        `Daar heeft LaVega geen gegevens van. Beschikbaar is ${f.from} tot en met ${f.to}.`,
    },
  },
  en: {
    weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    spending: (f) => ({
      title: "Yesterday's spending",
      short: `You spent ${f.yesterday} yesterday, ${f.diff} ${f.more ? "more" : "less"} than last ${f.weekday}.`,
      long: `You spent ${f.yesterday} yesterday, ${f.diff} ${f.more ? "more" : "less"} than last ${f.weekday}. See in LaVega where it went.`,
    }),
    renewal: (f) => ({
      title: "Subscription renews",
      short: `${f.name} renews ${f.when}${f.amount === null ? "" : `, ${f.amount}`}.`,
      long: `${f.name} renews ${f.when}${f.amount === null ? "" : ` for ${f.amount}`}. Cancel in time if you no longer use it.`,
    }),
    dueDate: (f) => ({
      title: "Date coming up",
      short: `${f.name} is due ${f.when}, on ${f.date}.`,
      long: `${f.name} is due ${f.when}, on ${f.date}. Make sure the money is ready.`,
    }),
    rateOffer: (f) => ({
      title: "More interest available",
      short: `${f.name} would earn you about ${f.gain} more interest a year on your savings.`,
      long: `${f.name} would earn you about ${f.gain} more interest a year on your savings than today. See the comparison under Optimise.`,
    }),
    cardOffer: (f) => ({
      title: "Better card",
      short: `Based on your spending, ${f.name} would leave you about ${f.gain} a year better off.`,
      long: `Based on your spending, ${f.name} would leave you about ${f.gain} a year better off than your current card. See the comparison under Optimise.`,
    }),
    when: (n) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`),
    tips: {
      "subscription-overlap": {
        title: "Overlapping subscriptions",
        short: "You have subscriptions that do the same thing. See if you can cancel one.",
        long: "You have subscriptions that do the same thing. Open Subscriptions in LaVega and see if you can cancel one.",
      },
      "price-increase": {
        title: "Subscription got pricier",
        short: "One of your subscriptions got more expensive. Is it still worth the price?",
        long: "One of your subscriptions got more expensive. Open Subscriptions in LaVega and check whether it is still worth the price.",
      },
      "many-subscriptions": {
        title: "Many subscriptions",
        short: "You have many running subscriptions. Go through them and keep what you use.",
        long: "You have many running subscriptions. Open Subscriptions in LaVega, go through them and keep what you really use.",
      },
      "idle-balance": {
        title: "A lot on your current account",
        short: "There is a lot on your current account. Compare what a savings account pays.",
        long: "There is a lot on your current account. Compare under Optimise in LaVega what a savings account with free withdrawals pays.",
      },
      "fee-heavy-account": {
        title: "Bank fees",
        short: "You paid bank fees in recent months. Compare what other accounts cost.",
        long: "You paid bank fees in recent months. Open Accounts in LaVega and compare what other accounts cost.",
      },
    },
    consentReminder: {
      title: "Reconnect your bank",
      short: "Your bank connection expires soon. Reconnect your bank to keep your alerts.",
      long: "Your bank connection expires soon. Reconnect your bank in LaVega and your alerts keep coming.",
    },
    pausedNotice: {
      title: "Alerts paused",
      short: "Your alerts are paused because your bank connection expired. Reconnect your bank.",
      long: "Your alerts are paused because your bank connection expired. Reconnect your bank in LaVega to resume them.",
    },
    tools: {
      spendingOnDay: (f) => `On ${f.date} you spent ${f.amount}.`,
      spendingInRange: (f) =>
        `From ${f.from} through ${f.to} you spent ${f.amount}${f.category === null ? "" : ` on ${f.category}`}.`,
      compare: (f) =>
        f.direction === "same"
          ? `On ${f.date} you spent ${f.amount}, the same as last ${f.weekday} (${f.lastDate}).`
          : `On ${f.date} you spent ${f.amount}, ${f.diff} ${f.direction === "more" ? "more" : "less"} than last ${f.weekday} (${f.lastDate}, ${f.lastAmount}).`,
      upcomingNone: (f) => `No recurring charges are due in the next ${f.days} days.`,
      upcomingItem: (f) => `${f.name}: ${f.amount} on ${f.date}.`,
      upcomingMore: (f) => `${f.more} more charges are not listed.`,
      upcomingTotal: (f) => `${f.amount} in total over the next ${f.days} days.`,
      topNone: (f) => `There is no spending from ${f.from} through ${f.to}.`,
      topItem: (f) => `${f.category}: ${f.amount}.`,
      coverage: (f) => `LaVega only has data from ${f.from} through ${f.to}.`,
      outsideWindow: (f) => `LaVega has no data for that. Available is ${f.from} through ${f.to}.`,
    },
  },
};
