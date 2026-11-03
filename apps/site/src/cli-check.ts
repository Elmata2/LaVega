import { resolve } from "node:path";
import { Effect } from "effect";
import { checkPages } from "./check";
import { loadPages } from "./content";
import { runCli } from "./run";

const dir = resolve(process.argv[2] ?? "../../content");

const program = Effect.gen(function* () {
  const pages = yield* loadPages(dir, { drafts: true });
  const status = new Map(pages.map((p) => [p.file, p.status]));
  let failed = 0;
  for (const f of checkPages(pages)) {
    const published = status.get(f.file) === "published";
    if (published) failed++;
    console.log(`${published ? "ERROR" : "warn "} ${f.file} [${f.rule}] ${f.detail}`);
  }
  console.log(`${pages.length} pages checked, ${failed} errors on published pages`);
  return failed > 0 ? 1 : 0;
});

await runCli(program);
