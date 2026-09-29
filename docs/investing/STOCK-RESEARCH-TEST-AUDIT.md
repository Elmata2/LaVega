# Stock research test audit

Scope: PR #183, `apps/investing-server/src/stockResearch.test.ts`. Reviewed full test,
service, routes, SDK response types, sibling portfolio/System One tests, CI routing and
feature commit `17ba73d`. Audit uses LaVega's Vitest, TypeScript and lint commands;
OpenClaw-specific skills and runner scripts referenced by test-audit are absent here.

## Removed assertions and reduced exports

Candidate: `one typed request evaluates five lenses on identical company facts`.
The exact prompt fragment and internal ten-question/key checks detected wording and
implementation changes, rather than delivery of the five displayed judgments. The real
caller is `stockResearchRoutes.ts`; the remaining output assertions protect probability
conversion, conviction and missing views. The streaming route test verifies financial
facts at the actual model boundary. The checks originated with the feature commit, not
an older regression. Removed assertions have low risk; focused proof is the stock
research and sibling chat/judgment suites. Removed unused public exports of the internal
question builder and TTL constant. TTL expectations now use the independent one-hour
product contract rather than importing the value under test.

## Retained contracts and strengthened proof

Signed-report tests remain: they protect authentication, tenant ownership, unchanged
facts, size limits and one-hour expiry. The round trip is valuable evidence preservation,
not a copied identity helper. An independent Node HMAC verifies the Web Crypto signature
and existing token format, guarding against matching mistakes in signing and verification.
This extends the existing contract owner rather than creating another test layer.

Ticker validation remains because exchange suffix support and rejection of prompt/path
input have distinct parser risks. Route tests retain consent gates, revoked consent,
provider failure, malformed message roles and body limits. The stream mock tests transport
delivery, not an AI's financial reasoning; model-bound input now checks labeled valuation,
margin and ROE facts rather than an ambiguous numeric substring. Production evidence from
the preview separately verifies real model replies.

The import-boundary test is a retained architecture contract. CI run `36623217887`
failed because `stockResearch.ts` imported `node:crypto` on the portable investing request
path. Replaced Node crypto and Buffer with Web Crypto and standard base64 APIs. The same
architecture test now passes; the token security and SDK stream tests also pass.

No tests were deleted, no test-only production paths were added, and no unrelated
worktrees or user edits are part of this audit. Full CI must pass before landing.
