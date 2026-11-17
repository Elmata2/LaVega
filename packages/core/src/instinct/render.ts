import { INSTINCT_COPY, type MessageLocale } from "./copy.js";
import type { Candidate } from "./types.js";
import type { TipId } from "./tips.js";

/** `short` is push and WhatsApp (at most 120 characters), `long` is email and
 *  the in-app feed. `whatsappParams` fill the approved utility template's
 *  variables: it has exactly one body variable, the short text. No newlines or
 *  tabs, which Meta rejects in a parameter. */
export type RenderedMessage = {
  title: string;
  short: string;
  long: string;
  whatsappParams: [string];
};

const NAME_MAX = 40;
const TAG = { nl: "nl-NL", en: "en-GB" } as const;

/** Whole euros drop the decimals ("€ 84"), anything else shows cents ("€ 15,99").
 *  The no-break space Intl puts after the symbol becomes a normal space. */
export function formatCents(locale: MessageLocale, cents: number): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat(TAG[locale], {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })
    .format(cents / 100)
    .replaceAll("\u00a0", " ");
}

export function formatDay(locale: MessageLocale, day: string): string {
  return new Intl.DateTimeFormat(TAG[locale], {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
    .format(new Date(`${day}T00:00:00Z`))
    .replaceAll("\u00a0", " ");
}

function clipName(name: string): string {
  const s = name.replace(/\s+/g, " ").trim();
  return s.length <= NAME_MAX ? s : `${s.slice(0, NAME_MAX - 1).trimEnd()}…`;
}

function finish(t: { title: string; short: string; long: string }): RenderedMessage {
  const flat = (s: string) => s.replace(/[\r\n\t]+/g, " ");
  return { ...t, whatsappParams: [flat(t.short)] };
}

export function renderCandidate(c: Candidate, locale: MessageLocale): RenderedMessage {
  const k = INSTINCT_COPY[locale];
  switch (c.kind) {
    case "spending": {
      const f = c.figures;
      return finish(
        k.spending({
          yesterday: formatCents(locale, f.yesterdayCents),
          diff: formatCents(locale, Math.abs(f.diffCents)),
          more: f.diffCents > 0,
          weekday: k.weekdays[f.weekday] ?? "",
        }),
      );
    }
    case "deadline": {
      const f = c.figures;
      const name = clipName(f.name);
      const when = k.when(f.daysAway);
      if (f.what === "renewal")
        return finish(
          k.renewal({
            name,
            when,
            amount: f.amountCents === null ? null : formatCents(locale, f.amountCents),
          }),
        );
      return finish(k.dueDate({ name, when, date: formatDay(locale, f.dueDate) }));
    }
    case "better-offer": {
      const f = c.figures;
      const args = { name: clipName(f.name), gain: formatCents(locale, f.yearlyGainCents) };
      return finish(f.what === "rate" ? k.rateOffer(args) : k.cardOffer(args));
    }
    case "tip": {
      const text = (k.tips as Record<string, (typeof k.tips)[TipId] | undefined>)[c.figures.tipId];
      if (!text) throw new Error("unknown tip");
      return finish(text);
    }
  }
}

export function renderConsentReminder(locale: MessageLocale): RenderedMessage {
  return finish(INSTINCT_COPY[locale].consentReminder);
}

export function renderPausedNotice(locale: MessageLocale): RenderedMessage {
  return finish(INSTINCT_COPY[locale].pausedNotice);
}
