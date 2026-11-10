# Freelancer cash-flow in Jouw plan (design, 27 Oct 2026)

## Intent
A user with freelance or business work ("bij wijze een freelancer zal veel cashflow problemen hebben") got two text notes in Jouw plan and nothing computed. They now get a computed cash-flow card. Only people whose intake work kinds include freelance or business get it (review ruling: the income-spread trigger is dropped, it caught employed people with holiday pay and a 13th month). Everyone else sees nothing new.

## What the user sees
One card "Kasstroom bij wisselend inkomen", open by default, rendered after the seven section cards and before the scenario table. It is not one of the seven SECTION_IDS. Shown only when the work kinds include freelance or business. Parts inside, same frame as other cards:
1. How irregular: months looked at, client income per month (min / median / max), months without client income, longest gap between client payments, variability (std / mean).
2. Quiet month: a month with no client income = steady income - spending; how many such months the savings cover.
3. Forward look, 6 months: lowest expected balance in the typical path and in the quiet path (client income stops for the longest dry stretch seen, min 1 month). Warning when a path goes below zero.
4. Recommendations with the calculation open ("Zo is het berekend"): buffer target for irregular income, income-tax set-aside per month, VAT set-aside per month (only if the user charges VAT) with the next filing deadline.

## Decisions
- **Client income (revised rule, 27 Oct review M1+S3)**: a positive, euro, personal-scope row after `cleanTxs` (own transfers out) that is (a) in no known category: salary and benefits are "Inkomen", refunds sit in the shop's category, Tikkie and friends in "Tussen personen"; (b) not from a counterparty that also paid "Inkomen" (the employer: holiday pay, 13th month); (c) not worded like pay (salaris, vakantie, eindejaar, 13e, bonus, uitkering, pensioen, toeslag, declaratie ...); and (d) marked as a company or invoice (BV, VOF, NV, holding, stichting, factuur, invoice, opdracht ...). Uncategorised money with no such mark is NOT counted. Deviation from the ruling's wording: a bare "uncategorised is excluded" would exclude every real client invoice, because real invoices land in "onbekend"; the company/invoice mark is the narrowest way to keep them in. How regular the payments are plays no part, so a client that pays every month counts. The counted payments are listed in the card so the person can check them. All other incoming money is "other income"; its median month is the steady income.
- **Not a SECTION_ID**: adding an eighth section would touch snapshots, change log, fact sheet and AI copy. The cash-flow result is `PlanResult.cashflow` (null when it does not apply) and has its own card. Its figures are not in the change log (known gap).
- **Buffer target rule (LaVega's own rule, labelled as such, not an official norm)**: months = clamp(3 + longest run of consecutive months without client income, 3, 12); amount = months x fixed costs per month. With no client payment at all the dry stretch is 0 (no data on clients is not a dry spell). Why: you need to bridge the longest dry stretch you have actually seen, plus a base of 3 months for a late-paying client. The person's own buffer target (intake) is shown beside it and never overwritten.
- **Income tax set-aside**: no verified public fact exists (PUBLIC_FACTS is empty; owner verifies). So the percentage is the user's own input (new optional preference `incomeTaxSetAsidePct`); until entered the card shows the formula and the input. No pending fact id was added: it would show up in the Goals section's pending-facts list. Base = average monthly client income excluding VAT. Business costs are not known, so the amount is on the safe (high) side.
- **VAT set-aside**: only when the new intake answer `chargesVat` is true. Rate = NL tax pack default (21%, `taxPack("NL")`, rules as of its `rulesAsOf`), amount = client income x rate/(100+rate) (bank amounts include VAT). VAT you paid on costs is not subtracted, so it is on the high side. Deadline from `nextVatPeriod("quarterly", ...)`; quarterly is the pack default frequency and is said so.
- **Intake**: one new screen `vat` ("Reken je btw?" Ja/Nee) after `work`, only when work includes freelance or business. Stored as `chargesVat: Field<boolean>` on the profile (optional key, old vaults decode).
- Money in cents. NL + EN copy typed-complete.

## Non-goals
Income-tax rate lookup, voorbelasting, KOR, zelfstandigenaftrek, payment-term (late invoice) modelling, change-log entries, AI text.

## Known limits (shown to the user or in the report)
Spending uses the median month of outgoing money; business costs paid from the same account count as spending. Foreign-currency rows are left out.

- **Start balance** = liquid personal accounts (rolled forward); when no account has a known balance, the savings total the person typed, and the card says so.

## Revision after the independent review (27 Oct)
- **Spending** = average month of all outgoing money in the window (periodic costs such as quarterly tax, insurance, yearly costs are in it), not the median. When VAT is answered and an income-tax percentage is typed, payments to the tax office (Belastingdienst, omzetbelasting, inkomstenbelasting, voorlopige aanslag) leave spending, because the paths subtract the set-asides instead; otherwise they stay in (conservative).
- **Forward paths** subtract the recommended VAT and income-tax set-asides from the typical path. The "no warning" sentence names the stretch the quiet path tested (`quietMonths`, horizon 6).
- **VAT**: rate 21% from the NL pack; filing frequency from the person's saved tax setup of the entity that holds the personal accounts (default quarterly). Period amount = client receipts inside the period filed next x 21/121, shown beside the deadline ("uiterlijk"). Income tax says "including any VAT" until the VAT question is answered.
- **VAT question** is also on the card (Ja/Nee) and in Over jou as an editable "Niet ingevuld" row for freelance/business users who finished the intake before it existed.
- **Stated start balance** is named as such in the calculation lines; labels say "stand van je geld".
- Percentage is clamped to 0-60 in core as well.
