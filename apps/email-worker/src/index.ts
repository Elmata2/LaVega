/* De Cloudflare Email Worker: het enige bestand hier dat het platform aanraakt.
 *
 * Het is met opzet bijna leeg. Alles wat een beslissing neemt zit in handler.ts
 * en is daar getest zonder Cloudflare; wat hier staat kan alleen in productie
 * falen, en dus staat er zo weinig als mogelijk.
 *
 * Twee dingen doet dit bestand die handler.ts niet kan:
 *   1. `EmailMessage` uit `cloudflare:email` erbij halen — die module bestaat
 *      alleen in de Workers-runtime, dus hij wordt als `makeReply` naar binnen
 *      gegeven in plaats van daar geïmporteerd.
 *   2. Een onverwachte fout alsnog in een bounce veranderen. Dat is de laatste
 *      vangrail: als `handleInboundEmail` op iets omvalt waar niet op gerekend
 *      is, mag de mail nog steeds niet stil verdwijnen.
 */

import { EmailMessage } from "cloudflare:email";
import { applyVerdict, handleInboundEmail } from "./handler.js";
import type { Env, ForwardableEmailMessage } from "./types.js";

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const deps = {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input as RequestInfo, init),
      makeReply: (from: string, to: string, raw: string) => new EmailMessage(from, to, raw),
    } as const;

    try {
      const verdict = await handleInboundEmail(message, env, deps);
      await applyVerdict(message, verdict, deps);
      if (verdict.kind === "queued") {
        // In `wrangler tail` te zien bij de eerste echte factuur. Geen adres,
        // geen onderwerp, geen bedrag: alleen de telling.
        console.log("[lavega-email-in] " + verdict.detail);
      } else {
        console.log(
          "[lavega-email-in] " +
            verdict.kind +
            ": " +
            ("reason" in verdict ? verdict.reason : verdict.body.split("\n")[0]),
        );
      }
    } catch (error) {
      // Hier komen we alleen als handler.ts of applyVerdict zelf omvalt. De mail
      // is dan NIET verwerkt en mag dus niet als aangekomen gelden.
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[lavega-email-in] onverwachte fout: " + detail);
      message.setReject(
        (
          "LaVega kon deze mail niet verwerken door een onverwachte fout in de e-mailworker: " +
          detail
        ).slice(0, 400),
      );
    }
  },
};
