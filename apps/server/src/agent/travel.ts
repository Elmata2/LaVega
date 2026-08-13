import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PROMPT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "prompts", "travel.md");

export type KnownFact = { subject: string; key: string; value: string };
export type TravelInput = {
  homeCountry: string;
  destination: string;
  currency: string;
  providers: string[];
  knownFacts: KnownFact[];
};

const MAX_PROVIDERS = 12;
const MAX_FACTS = 60;
const MAX_FIELD = 60;

/** A two-letter country code, or "" — never free text (it ends up in a search
 *  query, and a country code cannot carry personal information). */
function countryCode(raw: unknown): string {
  const s = String(raw ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : "";
}

function shortField(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return s.slice(0, MAX_FIELD);
}

/** Defence in depth for provider names. A provider is a BRAND ("Trading 212",
 *  "N26"), never an account identifier — but an account imported without a bank
 *  is named after its own number, so a caller bug could turn "A 286-41213" into
 *  a "provider" and hand an identifier to the model. Anything carrying an IBAN
 *  or a run of 4+ digits is refused here regardless of what the caller thinks.
 *  Real brands don't have that shape; account numbers always do. */
function looksLikeAccountNumber(s: string): boolean {
  return /[A-Z]{2}\d{2}[A-Z0-9]{8,}/i.test(s) || /\d{4}/.test(s);
}

/** THE redaction boundary for the travel agent — the tightest in the app.
 *
 *  Only a home country, a destination, a currency, provider NAMES, and facts
 *  already known may reach Claude. Balances, amounts, account keys, IBANs,
 *  transactions, dates and entity names are structurally unable to pass: this
 *  builds a fresh object from allowlisted, length-capped, shape-checked fields
 *  and never copies the input. The ranking that needs the money happens locally. */
export function sanitizeTravelInput(raw: unknown): TravelInput {
  if (!raw || typeof raw !== "object") throw new Error("ongeldige invoer");
  const o = raw as Record<string, unknown>;

  const destination = countryCode(o.destination);
  if (!destination) throw new Error("geen geldige bestemming");
  const homeCountry = countryCode(o.homeCountry) || "NL";
  const currency = /^[A-Z]{3}$/.test(String(o.currency ?? "").toUpperCase())
    ? String(o.currency).toUpperCase()
    : "";

  const rawProviders = Array.isArray(o.providers) ? o.providers : [];
  if (rawProviders.length > MAX_PROVIDERS) throw new Error("te veel aanbieders");
  const providers = [...new Set(rawProviders.map(shortField).filter((p) => p && !looksLikeAccountNumber(p)))];
  if (providers.length === 0) throw new Error("geen aanbieders");

  const rawFacts = Array.isArray(o.knownFacts) ? o.knownFacts : [];
  if (rawFacts.length > MAX_FACTS) throw new Error("te veel bekende feiten");
  const knownFacts: KnownFact[] = [];
  for (const r of rawFacts) {
    if (!r || typeof r !== "object") continue;
    const f = r as Record<string, unknown>;
    const subject = shortField(f.subject);
    const key = shortField(f.key);
    const value = shortField(f.value);
    if (subject && key && value) knownFacts.push({ subject, key, value });
  }

  return { homeCountry, destination, currency, providers, knownFacts };
}

const TERMS_TOOL = {
  name: "report_provider_terms",
  description: "Rapporteer de actuele voorwaarden per aanbieder. Laat een veld weg als je het niet kunt verifiëren.",
  input_schema: {
    type: "object",
    properties: {
      providers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            provider: { type: "string" },
            fxFeePct: { type: "number" },
            cashbackPct: { type: "number" },
            pointsPerEuro: { type: "number" },
            transferFreeViaIdeal: { type: "number", enum: [0, 1] },
            note: { type: "string" },
          },
          required: ["provider"],
        },
      },
    },
    required: ["providers"],
  },
} as const;

export type ProviderTerms = {
  provider: string;
  fxFeePct?: number;
  cashbackPct?: number;
  pointsPerEuro?: number;
  transferFreeViaIdeal?: number;
  note?: string;
};

const WEB_SEARCH = { type: "web_search_20260209", name: "web_search", max_uses: 6 } as const;

function numeric(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Look up current product terms via Sonnet 5 + web search (fees change, so a
 *  bundled table would go stale — that is why the indicative tables were
 *  dropped). The ONLY place the Anthropic SDK is touched for travel, and it only
 *  ever sees the sanitized input. Results are filtered back to the providers we
 *  asked about, so the model can't introduce products the user doesn't hold. */
export async function lookupProviderTerms(
  input: TravelInput,
  apiKey: string,
  deps: { client?: Anthropic } = {},
): Promise<ProviderTerms[]> {
  const client = deps.client ?? new Anthropic({ apiKey });
  const instructions = (() => {
    try {
      return readFileSync(PROMPT_FILE, "utf8");
    } catch {
      return "";
    }
  })();

  const known = input.knownFacts.length
    ? `\n\nAl bekend (door de gebruiker gecorrigeerd — niet tegenspreken):\n${input.knownFacts
        .map((f) => `- ${f.subject} ${f.key} = ${f.value}`)
        .join("\n")}`
    : "";

  const message = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 2048,
    system: instructions,
    tools: [WEB_SEARCH as never, TERMS_TOOL as never],
    // NOT a forced tool_choice. Forcing this tool makes the model report on its
    // FIRST turn, before it can run a single web search — and since the prompt
    // (rightly) forbids guessing, it then reports provider names with no fields
    // at all. Measured: forced => zero searches and empty terms; auto => ~10
    // searches and correctly hedged answers. The prompt still says to answer
    // only through this tool, and a reply without it yields no terms.
    tool_choice: { type: "auto" },
    messages: [
      {
        role: "user",
        content:
          `Thuisland: ${input.homeCountry}. Bestemming: ${input.destination}` +
          (input.currency ? ` (${input.currency})` : "") +
          `.\nAanbieders: ${input.providers.join(", ")}.${known}`,
      },
    ],
  });

  const block = message.content.find((b) => b.type === "tool_use" && b.name === TERMS_TOOL.name);
  if (!block || block.type !== "tool_use") return [];
  const rows = (block.input as { providers?: unknown }).providers;
  if (!Array.isArray(rows)) return [];

  // Only report back on providers we actually asked about, matched case-insensitively.
  const wanted = new Map(input.providers.map((p) => [p.toLowerCase(), p]));
  const out: ProviderTerms[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const asked = wanted.get(String(o.provider ?? "").trim().toLowerCase());
    if (!asked) continue;
    out.push({
      provider: asked,
      fxFeePct: numeric(o.fxFeePct),
      cashbackPct: numeric(o.cashbackPct),
      pointsPerEuro: numeric(o.pointsPerEuro),
      transferFreeViaIdeal: o.transferFreeViaIdeal === 1 ? 1 : o.transferFreeViaIdeal === 0 ? 0 : undefined,
      note: typeof o.note === "string" ? o.note.slice(0, 400) : undefined,
    });
  }
  return out;
}
