import { createHash } from "node:crypto";
import { generateText, jsonSchema, Output, type LanguageModel } from "ai";
import {
  renderPortfolioBrief,
  type InvestingDashboardData,
  type SectorExposure,
} from "@lavega/core";
import type { AgentMemoryRepository, LetterObservation, PortfolioLetter } from "@lavega/database";
import { PORTFOLIO_CHAT_PROFILES } from "./personaProfiles.js";
import { resolvePortfolioChatModel } from "./portfolioChat.js";

/*
 * Munger-03: one stored letter from Charlie per broker-sync snapshot. The
 * snapshot hash covers what the broker reported (quantities, cost basis,
 * realized gains, dividends) and never prices, so a price move alone cannot
 * trigger a model call.
 */

export const MAX_LETTER_OBSERVATIONS = 3;
export const LETTER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const GENERATE_TIMEOUT_MS = 60_000;

export type LetterDraft = { verdict: string; observations: LetterObservation[] };
export type LetterGenerator = (input: {
  dashboard: InvestingDashboardData;
  sectors: readonly SectorExposure[] | null;
}) => Promise<LetterDraft>;

const digest = (parts: readonly string[]): string =>
  createHash("sha256").update(parts.join("\n")).digest("hex");

export function letterHashes(dashboard: InvestingDashboardData): {
  snapshotHash: string;
  holdingsHash: string;
} {
  const positions = [...dashboard.positions].sort((a, b) => a.symbol.localeCompare(b.symbol));
  return {
    holdingsHash: digest(positions.map((p) => `${p.symbol}:${p.quantity}`)),
    snapshotHash: digest(
      positions.map((p) =>
        [
          p.symbol,
          p.quantity,
          p.returns.remainingCostBasis,
          p.returns.realizedGain,
          p.returns.dividendsReceived,
        ].join(":"),
      ),
    ),
  };
}

/** Generate when there is no letter or holdings changed; never when the
 *  snapshot is unchanged; otherwise only once the last letter is a week old. */
export function shouldGenerateLetter(
  latest: Pick<PortfolioLetter, "snapshotHash" | "holdingsHash" | "createdAt"> | null,
  current: { snapshotHash: string; holdingsHash: string },
  now: number,
): boolean {
  if (!latest) return true;
  if (latest.snapshotHash === current.snapshotHash) return false;
  if (latest.holdingsHash !== current.holdingsHash) return true;
  return now - Date.parse(latest.createdAt) >= LETTER_INTERVAL_MS;
}

const clean = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** Keeps at most three well-formed observations and drops the rest. */
export function normalizeLetterDraft(raw: unknown): LetterDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const draft = raw as { verdict?: unknown; observations?: unknown };
  const verdict = clean(draft.verdict, 600);
  if (!verdict || !Array.isArray(draft.observations)) return null;
  const observations: LetterObservation[] = [];
  for (const item of draft.observations as Array<Record<string, unknown> | null>) {
    const title = clean(item?.title, 120);
    const body = clean(item?.body, 800);
    const figures = Array.isArray(item?.figures)
      ? (item.figures as unknown[])
          .map((figure) => clean(figure, 60))
          .filter(Boolean)
          .slice(0, 6)
      : [];
    if (title && body && figures.length > 0) observations.push({ title, body, figures });
    if (observations.length === MAX_LETTER_OBSERVATIONS) break;
  }
  return observations.length > 0 ? { verdict, observations } : null;
}

const LETTER_SCHEMA = jsonSchema<unknown>({
  type: "object",
  properties: {
    verdict: { type: "string" },
    observations: {
      type: "array",
      maxItems: MAX_LETTER_OBSERVATIONS,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          figures: { type: "array", items: { type: "string" } },
        },
        required: ["title", "body", "figures"],
      },
    },
  },
  required: ["verdict", "observations"],
});

export function createLetterGenerator(model?: LanguageModel): LetterGenerator {
  return async ({ dashboard, sectors }) => {
    const { output } = await generateText({
      model: model ?? resolvePortfolioChatModel(),
      abortSignal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
      output: Output.object({ schema: LETTER_SCHEMA }),
      instructions: `${PORTFOLIO_CHAT_PROFILES.charlie_munger}

You are now writing a short letter to the owner about their whole portfolio. Rules:
- Give the verdict first: one or two sentences in plain text, without Markdown.
- Then give at most ${MAX_LETTER_OBSERVATIONS} observations. Each has a short title, a body of at most three sentences, and a figures list.
- Cite the owner's own numbers from the brief in every body. Copy each figure you cite, exactly as written in the brief, into that observation's figures list. Never invent a number.
- Pick the largest avoidable risks or the clearest strengths, not a tour of every holding.
Return one JSON object with the keys verdict and observations.`,
      prompt: `Portfolio brief:\n${renderPortfolioBrief(dashboard, sectors)}`,
    });
    const draft = normalizeLetterDraft(output);
    if (!draft) throw new Error("The model returned no usable letter");
    return draft;
  };
}

export async function ensureLetter(input: {
  dashboard: InvestingDashboardData;
  sectors: readonly SectorExposure[] | null;
  memory: AgentMemoryRepository;
  generate: LetterGenerator;
  now?: () => number;
}): Promise<{ letter: PortfolioLetter | null; generated: boolean }> {
  const latest = await input.memory.latestLetter();
  const hashes = letterHashes(input.dashboard);
  if (!shouldGenerateLetter(latest, hashes, (input.now ?? Date.now)()))
    return { letter: latest, generated: false };
  const draft = normalizeLetterDraft(
    await input.generate({ dashboard: input.dashboard, sectors: input.sectors }),
  );
  if (!draft) throw new Error("The model returned no usable letter");
  const stored = await input.memory.saveLetter({ id: crypto.randomUUID(), ...hashes, ...draft });
  /* A racing call may have stored this snapshot first; its letter wins. */
  return { letter: stored, generated: stored.id !== latest?.id };
}
