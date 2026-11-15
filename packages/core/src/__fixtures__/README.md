# Fixtures are captured bytes, not source

Every file here is a real page as it was actually served, kept so a parser can
be tested against what the web really returns rather than against a tidy
version of it. That makes the whitespace part of the data.

**Do not run a formatter over this directory.** `bank-nl-betalen-in-buitenland-2026-08-16.html`
was reformatted by `oxfmt` in `15c4a85` (a 614-file "adopt oxlint and oxfmt"
commit), which silently broke the bank.nl parser's footnote handling: the
parser reads across `<figcaption>` boundaries and collapses runs of whitespace,
so re-indenting the HTML changed what it extracted. The suite went red and
stayed red on master for ten days, because the commit looked like formatting
and nobody re-read a 4018-line diff in a fixture.

`.oxfmtrc.json` now lists `**/__fixtures__/**` under `ignorePatterns`. The same
entry covers `docs/n8n/*.json`, which are generated exports rather than captured
ones but fail the same way: `scripts/sync-n8n-code.mjs` writes the Code-node
bodies into them from `packages/core/src/n8n/`, and
`packages/core/src/n8n/codeNodes.test.ts` fails when they drift.

If you need to refresh a fixture, replace it with a new capture and say where it
came from and when, the way the filenames here already do.
