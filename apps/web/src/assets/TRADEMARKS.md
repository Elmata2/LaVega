# Merken en logo's

_Gegenereerd door `scripts/bundle-bank-logos.ts` op 2026-08-20. Niet met de hand aanpassen._

**De genoemde merken, handelsnamen en logo's zijn eigendom van hun respectieve
eigenaren. LaVega is niet aangesloten bij, en wordt niet gesponsord of
onderschreven door, een van deze partijen. De logo's worden uitsluitend gebruikt
om het product of de rekening van de gebruiker te identificeren (nominatief
gebruik).**

Deze regel hoort bij launch op de juridische/over-pagina te staan. Op de
werkende schermen staat hij bewust niet — zie `docs/BACKLOG.md`: disclaimers en
voorwaarden horen bij de launch, niet in het werkende scherm.

Elk logo is tijdens een sweep bij de aanbieder zelf opgehaald en als data-URI in
de bundel gelegd. De browser haalt niets op. Verwijderverzoek van een
rechthebbende: haal de regel uit `BRANDS` in het script en laat de sweep
opnieuw lopen — het logo verdwijnt dan uit de bundel.

| Merk | slug | Gevonden als | Bytes | Gelezen op | Bron |
| --- | --- | --- | --- | --- | --- |
| RegioBank | `regiobank` | favicon | 2027 | 2026-08-20 | https://www.regiobank.nl/static/design/966E27C7-8DDC-4D5A-B9BD-3849A0628C97-fsm/rel/shortcut_icon/favicon-32x32.png?random=D8A2 |
| ING | `ing` | favicon | 15086 | 2026-08-20 | https://ing.com/webfiles/1787152405916/images/favicon.ico |
| ABN AMRO | `abnamro` | favicon | 1150 | 2026-08-20 | https://www.abnamro.nl/nl/owa/static//favicon.ico |
| Rabobank | `rabobank` | favicon (ander pad op het eigen domein) | 1150 | 2026-08-20 | https://bankieren.rabobank.nl/favicon.ico |
| Knab | `knab` | favicon | 1150 | 2026-08-20 | https://www.knab.nl/favicon.ico |
| bunq | `bunq` | favicon | 2180 | 2026-08-20 | https://framerusercontent.com/images/gMs4vTm0VTAnkhjbCzFf7afeCE.svg |
| Triodos | `triodos` | favicon | 1299 | 2026-08-20 | https://www.triodos.nl/webfiles/1786540084927/static/img/svg/favicon.svg |
| NN | `nn` | favicon | 1905 | 2026-08-20 | https://www.nn.nl/nn-static/static/design/67EE1C60-E1D6-4989-903D-8B96409C570D-D620-fsm/img/favicon-32x32.png |
| Revolut | `revolut` | Wikimedia Commons — zie de licentietabel onderaan | 1638 | 2026-08-20 | https://upload.wikimedia.org/wikipedia/commons/d/d6/Revolut.svg |
| American Express | `americanexpress` | favicon.ico | 1358 | 2026-08-20 | https://www.americanexpress.com/favicon.ico |
| Trading 212 | `trading212` | favicon | 994 | 2026-08-20 | https://www.trading212.com/favicon-32x32.png |
| N26 | `n26` | favicon | 606 | 2026-08-20 | https://n26.com/_build/favico.ico |
| Wise | `wise` | favicon | 343 | 2026-08-20 | https://wise.com/public-resources/assets/icons/wise-personal/favicon_32x32.png |
| International Card Services | `ics` | favicon | 930 | 2026-08-20 | https://assets.icscards.nl/static/images/favicons/favicon.png |

## Bewust geen logo

Deze uitgevers staan wel in de catalogus maar krijgen géén logo. Ze vallen in de
UI terug op de banknaam en de kaartkleuren — nooit op het logo van een andere
bank, want een verkeerd logo is erger dan geen logo.

- **SNS** — snsbank.nl, asnbank.nl en regiobank.nl serveren byte-identieke icons (de Volksbank, één CMS) — niet toe te wijzen aan één merk
- **ASN** — zelfde de Volksbank-icoon als SNS en RegioBank — identificeert het merk niet
