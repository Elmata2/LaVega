import { randomUUID } from "node:crypto";
import {
  amsterdamDay,
  daysFromTo,
  dailyMessage,
  REPEAT_WINDOW_DAYS,
  renderCandidate,
  renderConsentReminder,
  renderPausedNotice,
  type Candidate,
  type RateBenchmark,
  type RenderedMessage,
} from "@lavega/core";
import {
  createAgentRepository,
  type AgentChannel,
  type AgentMirror,
  type AgentRepository,
  type AgentSettings,
  type AgentState,
  type Database,
} from "@lavega/database";
import type { EbSession } from "../eb-routes.js";
import { CONSENT_VERSION } from "../instinctConsent.js";
import { fetchForAgent } from "./unattendedFetch.js";

/* One user, one day: claim the day, read the bank into memory, pick at most one
 * message, send it, record that it went out. Transactions exist only inside
 * `decide`; when it returns, nothing in this module holds them. Errors thrown
 * from here carry no amounts, merchants or bank payloads (the callers below
 * and the cron log only the error's name). */

export const REMINDER_DAYS = 7;
/* One counter of unattended bank reads per user per day, shared by the cron and
 * WhatsApp. Enable Banking allows about 4. WhatsApp may take a read only while the
 * count is below 3, the cron while it is below 4: chat questions can never use up
 * the read the daily message needs, and the total never passes 4. */
export const WHATSAPP_FETCH_CAP = 3;
export const CRON_FETCH_CAP = 4;

export type EbSessionRow = { sessionId: string; payload: EbSession; createdAt: string };

export type ChannelSend = (
  userId: string,
  msg: RenderedMessage,
  settings: AgentSettings,
  eventId: string,
) => Promise<"sent" | "failed">;

export type InstinctDeps = {
  db: Database;
  now: () => Date;
  fetchSessions: (userId: string) => Promise<EbSessionRow[]>;
  rates: readonly RateBenchmark[];
  send: Record<AgentChannel, ChannelSend>;
  fetchOutcome?: typeof fetchForAgent;
};

export type RunResult = "sent" | "none" | "skipped" | "paused" | "reminded";

type Decision =
  | { kind: "skip"; release: boolean }
  | { kind: "none" }
  | { kind: "paused" }
  | { kind: "remind"; expiryDay: string }
  | { kind: "message"; candidate: Candidate; noBankData?: true };

const EMPTY_MIRROR: AgentMirror = { rules: [], dueDates: [], cardOffer: null };

/**
 * Everything here is keyed by the real current Amsterdam date: the claim, the no-repeat keys, the
 * dedupe keys, the day words the reader sees and the bank's fetch counter. The due-listing
 * (migration 0039) may call this after midnight for a send hour that began the evening before; that
 * retry still delivers, and it takes the real date's claim. So a user gets at most one message per
 * real calendar date, the claim never moves backwards, and the regular send of that same date is
 * then not made (it comes the next day). Claim and content are never a date apart.
 */
export async function runForUser(deps: InstinctDeps, userId: string): Promise<RunResult> {
  const repo = createAgentRepository(deps.db, userId);
  const settings = await repo.getSettings();
  if (!settings?.enabled) return "skipped";
  // A consent given to an older text does not stand for this one: no fetch, no send,
  // until the user agrees again in the app.
  if (settings.consentVersion !== CONSENT_VERSION) return "skipped";

  const today = amsterdamDay(deps.now());
  if (!(await repo.claimDay(today))) return "skipped";

  const progress = { delivered: false };
  try {
    const state = await repo.getState();
    const decision = await decide(deps, repo, userId, state, today);
    return await act(deps, repo, userId, settings, state, today, decision, progress);
  } catch (error) {
    // Once something went out the claim stays: a retry would send it twice.
    if (!progress.delivered) await repo.releaseDay(today).catch(() => undefined);
    throw error;
  }
}

/** Reads the bank and chooses. The transactions are local to this function. */
async function decide(
  deps: InstinctDeps,
  repo: AgentRepository,
  userId: string,
  state: AgentState,
  today: string,
): Promise<Decision> {
  const sessions = await deps.fetchSessions(userId);
  // Every unattended read shares one budget with the WhatsApp-triggered ones. When it is used
  // up, the day is not lost: whatever needs no bank data (a due date, the card offer) can still go.
  if (sessions.length > 0 && !(await repo.takeFetchBudget(today, CRON_FETCH_CAP))) {
    const mirror = (await repo.getMirror()) ?? EMPTY_MIRROR;
    const candidate = dailyMessage({
      today,
      txs: [],
      accounts: [],
      rules: mirror.rules,
      mirror,
      balances: [],
      rates: [],
      answers: {},
      state: { sentKeys: state.sentKeys, lastTipDate: state.lastTipDate },
      noBankData: true,
    });
    return candidate
      ? { kind: "message", candidate, noBankData: true }
      : { kind: "skip", release: false };
  }
  const outcome = await (deps.fetchOutcome ?? fetchForAgent)(sessions, deps.now().getTime());
  if (outcome.status === "no-bank") return { kind: "skip", release: true };

  const anyOk = outcome.banks.some((b) => b.state === "ok");
  if (!anyOk) {
    if (!outcome.banks.some((b) => b.state === "expired")) return { kind: "skip", release: true };
    // Expired consents never come back by themselves: say so once, then stay quiet.
    return state.expiryPausedNoted ? { kind: "skip", release: false } : { kind: "paused" };
  }

  if (outcome.consentExpiresAt) {
    const expiryDay = amsterdamDay(outcome.consentExpiresAt);
    const left = daysFromTo(today, expiryDay);
    if (left >= 0 && left <= REMINDER_DAYS && state.expiryRemindedFor !== expiryDay)
      return { kind: "remind", expiryDay };
  }

  const mirror = (await repo.getMirror()) ?? EMPTY_MIRROR;
  const candidate = dailyMessage({
    today,
    txs: outcome.txs,
    accounts: outcome.accounts,
    rules: mirror.rules,
    mirror,
    balances: outcome.balances,
    rates: deps.rates,
    answers: {},
    state: { sentKeys: state.sentKeys, lastTipDate: state.lastTipDate },
  });
  return candidate ? { kind: "message", candidate } : { kind: "none" };
}

async function act(
  deps: InstinctDeps,
  repo: AgentRepository,
  userId: string,
  settings: AgentSettings,
  state: AgentState,
  today: string,
  decision: Decision,
  progress: { delivered: boolean },
): Promise<RunResult> {
  switch (decision.kind) {
    case "skip":
      if (decision.release) await repo.releaseDay(today);
      return "skipped";
    case "none":
      // Nothing to say today: keep the claim so the bank is not read again.
      return "none";
    case "paused": {
      const msg = renderPausedNotice(settings.locale);
      const patch = { expiryPausedNoted: true };
      if (
        !(await deliver(
          deps,
          repo,
          userId,
          settings,
          msg,
          `paused:${today}`,
          today,
          progress,
          patch,
        ))
      )
        return "skipped";
      return "paused";
    }
    case "remind": {
      const msg = renderConsentReminder(settings.locale);
      const key = `reminder:${decision.expiryDay}`;
      const patch = { expiryRemindedFor: decision.expiryDay };
      if (!(await deliver(deps, repo, userId, settings, msg, key, today, progress, patch)))
        return "skipped";
      return "reminded";
    }
    case "message": {
      const { candidate } = decision;
      const msg = renderCandidate(candidate, settings.locale);
      const keep = state.sentKeys.filter((s) => daysFromTo(s.date, today) < REPEAT_WINDOW_DAYS);
      const patch = {
        sentKeys: [...keep, { key: candidate.key, date: today }],
        lastTipDate: candidate.kind === "tip" ? today : state.lastTipDate,
        /* A message built without the bank says nothing about the consent: keep the flag, so
         * the "paused" notice cannot come twice. */
        ...(decision.noBankData ? {} : { expiryPausedNoted: false }),
      };
      if (
        !(await deliver(
          deps,
          repo,
          userId,
          settings,
          msg,
          `daily:${today}`,
          today,
          progress,
          patch,
        ))
      )
        return "skipped";
      return "sent";
    }
  }
}

/** Sends on every chosen channel; true when at least one went out. When none
 *  did, the day's claim is released so the next run in the window tries again. */
async function deliver(
  deps: InstinctDeps,
  repo: AgentRepository,
  userId: string,
  settings: AgentSettings,
  msg: RenderedMessage,
  dedupeKey: string,
  today: string,
  progress: { delivered: boolean },
  patch: Partial<AgentState>,
): Promise<boolean> {
  const eventId = randomUUID();
  let sent = false;
  for (const channel of settings.channels) {
    let outcome: "sent" | "failed";
    try {
      outcome = await deps.send[channel](userId, msg, settings, eventId);
    } catch {
      outcome = "failed";
    }
    if (outcome === "sent") sent = true;
  }
  if (!sent) {
    await repo.releaseDay(today);
    return false;
  }
  progress.delivered = true;
  // State first: if the event write fails, tomorrow must not repeat today's message.
  await repo.putState(patch);
  await repo.appendEvent({
    id: eventId,
    channel: "feed",
    type: "message",
    body: { text: msg.long },
    dedupeKey,
  });
  return true;
}
