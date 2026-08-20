# App review — 20 August 2026 (dictated)

His framing: *"the structure is good, all the modules — now we go through it and see the
functionalities. Since we now have most of the data within the catalog, it's now a question whether
the data is used correctly."*

That sentence is the theme. Almost nothing below asks for new data; it is a list of places where
data we already hold is not reaching the screen, or reaches it wrong.

---

## P0 — wrong on screen, and the data to fix it already exists

**1. ING shows 0% in Optimalisatie.** *"That ING is 0% that's bullshit, we need to have those."*
The catalogue holds ING Oranje Spaarrekening's rate and ING betaalpas at 1,4% FX, yet the table
still falls back to `aangenomen 0%` for ING accounts. `resolveAccountRate` matches on bank name and
the catalogue rows are keyed differently, so the match misses. This is the most visible symptom of
the whole review.

**2. The "unknown" category.** Raised four separate times — the loudest item here. *"We really need
to look into this unknown shit."* An unknown € 4.000 in July flattens the statistics chart. His
instruction: **let the AI read the unknown ones out**, and he expects most to be foreign
transactions. He does not want an unknown bucket at all if it can be avoided. The AI-categorize
agent already exists for this and is not being pointed at these rows.

**3. Subscription detection is wrong.** A Simyo transaction of € 11,89/month is handled wrongly, and
a phantom entry ("Vone Luster" as transcribed) should not be there. *"Only the subscription I have
should be there."* One false positive plus one miss, in the module whose whole job is precision.

**4. Points disappear.** *"I added my points but they got removed again."* Entered data not
surviving is data loss and outranks every cosmetic item here.

**5. Double bank rows in Valuta.** *"Just show one ING — since we're converting it doesn't matter."*
Same root cause as the duplicate savings rows: catalogue and bundled names key differently.

---

## P1 — the agents should answer the fuller question

**6. Travel: cash withdrawal.** *"Also include taking money, physical cash. Which card can you take
out money?"* The catalogue already records withdrawal fees inside `conditions` (ING € 3,50 per
opname, ICS 4%, Amex 3,5% min € 4,50) but the travel agent prices card payments only. Withdrawal is
a separate row in every tariff document we read — the data is there, the question is not asked.

**7. Travel: cashback.** Now possible — 13 cashback figures landed on 19 August.

**8. Travel: Trading 212 versus Revolut.** *"It shows Revolut for the US, which in my head is the
best shot — but Trading 212 is cheaper."* 212 Card is one of only two products the catalogue can
prove at 0%. Check whether it is excluded because he does not hold it — the same "only ranks what
you hold" limit as everywhere else.

**9. Optimisation must include promos — and this cuts against yesterday's change.**
*"For a user who doesn't have bunq, if they can use the promo for a month it's still a month of
3,01% over the 2,5% of Scalable Capital."* Yesterday `bestRate` was changed to rank on the STANDARD
rate, because ranking on a teaser sends a saver somewhere worse in month seven. He is right that it
went one step too far: the promo is real money for the months it runs. The fix is not a revert — it
is to show BOTH, ranked on what you keep and annotated with what you could get now. Neither number
alone is honest.

**10. Valuta: all banks, best route chosen automatically.** *"When I transfer a thousand euros to
USD it should choose the best account or bank, and if the user wants to change they can choose
through all the banks available and the fee difference."* The travel agent's ranking, applied to
conversion, over the whole catalogue rather than his own accounts.

**11. Cards: the IBAN field.** Show it when known, but *"double check if you can get it from the CSV
or ESV exports or Enable Banking. If not, remove it."* A field that is always empty should not exist.

---

## P2 — structure and interaction

**12. Position per company as an opt-in widget** — in settings and in widget settings, with a note,
*"so it's up to the user if they want to use this or not."*

**13. Statistics: clickable, and cap the scale.** *"I'd rather have it a thousand"* — the unknown
€ 4.000 flattens everything else. Also per month and per weekday, click through to the amounts, and
add **average income and average expense**.

**14. A period-switch button** on subscriptions/abonnementen, and on the module he called "topics
managers".

**15. A better cost overview** than today, *"like an earlier version we worked with"*, where
categories such as transport were set automatically.

**16. Valuta: drop the right-hand panel, add an interactive map** to click the countries being
travelled to. Cosmetic — the one place he asked for prettier rather than truer.

**17. Real card art.** *"I know it's copyright and stuff, but I'm sure we can have some image, and
put in the conditions that it's not our image."* NOTE THE CONSTRAINT THIS HITS: LaVega never fetches
a remote image at runtime, because a logo request tells that server who the user banks with. So card
art must be bundled at build time, not loaded from the issuer — which means a small, deliberately
chosen set of images.

---

## Backlog additions he asked for explicitly

**18. Email Enable Banking and FinAPI** about acting as an LSP/TPP for a few months and what it
would cost — *"hopefully free"*. The prize: real-time access to most accounts **including Amex**,
which no CSV import gives us. Draft both; send after his review.

**19. The browser extension** — recorded 19 August, sharpened here: it should read the page the user
is on and surface the relevant points or discount (Amex points, ING offers) **at the moment of
buying**. Same posture constraints as recorded.

**20. Cloudflare email-routing instructions** to hand to his cofounder, so the invoice forwarding
address can be tested.

---

## Where he was satisfied

Accounts (*"works well"*), transactions (*"this is fine"*), cash flow (*"interesting, curious to see
how this works"*), forecast (*"just want to see how this goes"*), and the rent/travel improvement
(*"this is quite an improvement"*). Amex being unknown is explicitly fine — *"I can give you the
information one time"*, which is the `source: "user"` path working as designed.
