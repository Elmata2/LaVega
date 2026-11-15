# `@lavega/email-worker`

De Cloudflare Email Worker die facturen aanneemt op het doorstuuradres en ze
naar de n8n-webhook "E-mail binnen" POST.

**Instellen, deployen en wat je bij de eerste factuur nakijkt staat in
`docs/n8n/DOORSTUURADRES.md`.** Deze pagina gaat alleen over de indeling van deze
map.

## Indeling, en waarom

```
src/
  index.ts             het enige bestand dat het platform aanraakt
  handler.ts           het oordeel over één mail — geen platform-API
  parseMail.ts         MIME → {subject, from, date, text, html, attachments[]}   PUUR
  authResults.ts       onbekende auth-uitslag + adreshelpers (geen headertrust)   PUUR
  spoofGate.ts         lokale spoof-poort: wat zonder meting al onwaar is         PUUR
  queueLimit.ts        misbruikgrens per wachtrij, fail open als hij niet werkt
  replyMime.ts         een antwoordmail in elkaar zetten                         PUUR
  types.d.ts           de vier velden en drie methodes van Cloudflare die we gebruiken
  cloudflare-email.d.ts  de ambient declaratie van `cloudflare:email`
test/                  vitest; `pnpm --filter @lavega/email-worker test`
wrangler.toml
```

**De splitsing tussen `index.ts` en `handler.ts` is het hele punt van deze
indeling.** Wat een beslissing neemt zit in `handler.ts` en krijgt een bericht en
een `fetch` mee, dus het is volledig te testen zonder Cloudflare. Wat alleen in
productie kan falen — `EmailMessage` uit `cloudflare:email`, de vangrail rond een
onverwachte fout — staat in `index.ts` en is zo kort gehouden als het kan. Dat is
dezelfde scheiding die `packages/core/src/n8n/` al maakt tussen de geteste logica
en de n8n-adapter eronder.

**Nul afhankelijkheden**, met opzet. Geen `wrangler` en geen
`@cloudflare/workers-types` in `package.json`: er loopt niets mee in een pad dat
een factuur draagt, en er is niets dat tussen twee deploys stil van gedrag
verandert. De prijs is `src/types.d.ts` (met de hand getypt) en het feit dat je
wrangler per keer ophaalt met `pnpm dlx wrangler@4`. Base64, quoted-printable en
RFC 2047 staan daarom als gewone functies in `parseMail.ts`.

`tsconfig.json` typecheckt alleen `src/`. De testbestanden importeren `vitest` en
— voor `test/contract.test.ts` — `packages/core` via een relatief pad; dat zou
een `node_modules` in deze map vereisen, en dat is precies wat we hier niet
willen. De tests dráaien gewoon; vitest typecheckt niet.

## Wat de Worker lokaal weigert

`spoofGate.ts` weigert alleen wat zonder authenticatiemeting al onwaar is: een
From-regel die `lavega.dev` claimt terwijl de envelop ergens anders vandaan komt,
een lege envelop-afzender die geen leveringsmelding is, en een afzender zonder
bruikbaar domein. Het vergelijkt envelop- en From-domein **niet** met elkaar. Dat
zou de doorgestuurde factuur weigeren: MAIL FROM is dan Gmail, From is de
leverancier.

`queueLimit.ts` telt per wachtrij met de `INBOUND_RATE_LIMIT`-binding uit
`wrangler.toml` (20 per 60 seconden). Ontbreekt de binding of gooit hij, dan gaat
de mail door en staat de reden één keer in het log. Een ontbrekende teller mag
geen factuur weigeren.

## Het contract met `packages/core`

`test/contract.test.ts` voert een ruwe mail door de Worker én daarna door
`normalizeInboundMail` uit `packages/core`. Zonder die test zouden beide kanten
groen kunnen blijven terwijl een hernoemd veld (`to` → `address`) ervoor zorgt
dat er een lege regel in de wachtrij staat.
