/* `cloudflare:email` bestaat alleen in de Workers-runtime.
 *
 * Dit bestand staat los van types.d.ts omdat dát een module is (het heeft
 * `export`-regels), en een `declare module` binnen een module is een
 * módule-uitbreiding in plaats van een ambient declaratie — dan blijft
 * `import { EmailMessage } from "cloudflare:email"` in src/index.ts een
 * TS2307-fout. Hier, in een bestand zonder top-level import of export, werkt hij
 * zoals bedoeld.
 *
 * Alleen de constructor staat erin, want dat is het enige wat de Worker
 * gebruikt: `new EmailMessage(from, to, raw)` voor `message.reply()`.
 */

declare module "cloudflare:email" {
  export class EmailMessage {
    constructor(from: string, to: string, raw: string | ReadableStream);
  }
}
