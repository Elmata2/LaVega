# Cash-flow suggestions (confirm/reject unknown cash-flow types)

Issue #137 (Jev-04). The owner confirms or corrects the app's proposed kind for a broker type
string it does not recognise. Nothing applies without a click, and a sign-changing confirmation
needs an extra explicit acknowledgement.

- **Route:** `/profile#cash-flow-suggestions` (mounted: `/investing/profile#cash-flow-suggestions`).
- **Labels:** "Cash-flow suggestions", "N waiting for confirmation", "Broker's type",
  "Suggested kind", "Confidence NN%", "Amount and sign", "Confirm kind", "Reject",
  "Careful: this changes the sign", "Confirm sign change", "Confirmed rules", "Remove".
  Dutch: "Cashflow-suggesties", "N wachten op bevestiging", "Bevestig soort",
  "Bevestig tekenwijziging", "Bevestigde regels".
- **Data:** `GET /api/investing/cash-flow-suggestions` returns `{ enabled, count, pending[] }`;
  `GET /api/investing/cash-flow-rules` the rules. No route creates a suggestion: they come from
  a broker sync's unknown-type problems.
- **Seeded local fixture:** start the mounted app with a cash-flow store file, e.g.
  `INVESTING_MOUNT=1 INVESTING_CASH_FLOW_STORE_FILE=/tmp/cash-flow.json pnpm --filter @lavega/server dev`
  with `{ "enabled": true, "rules": [], "suggestions": [ …pending rows… ] }`. A pending row with
  a positive amount and a `withdrawal` kind is the sign-change case.
- **Drive:** open the profile page, scroll the panel into view. A pending row shows the raw
  type. For the sign-change row: the confirm button is disabled until the acknowledgement
  checkbox is ticked; the warning shows before → after. Confirm then reload: the row is gone
  and the kind appears under "Confirmed rules"; `GET /cash-flow-rules` lists it. Reject removes
  another row and it is not offered again. Toggle the switch off: no pending suggestion is
  shown.
- **Proves:** pending count and per-row fields; a confirmation creates the rule; a rejection is
  remembered; a sign change is loud, blocked and only sent with `acknowledgeSignChange: true`;
  the disabled state shows nothing pending; removal works.
- **Unreachable:** without a seeded store or a broker sync producing unknown types there is
  nothing pending; the panel then shows "No suggestions waiting." That is the empty state, not
  a failure. Local standalone (`control-investing up`) uses the in-memory store, so seed through
  the mounted app's file store.
