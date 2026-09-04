import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { createDockerFetch } from "./docker.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "lavega-investing-docker-"));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, "assets"));
  await writeFile(join(directory, "index.html"), "<html>dashboard</html>");
  await writeFile(join(directory, "assets", "app.js"), "console.log('dashboard')");
  return directory;
}

test("Docker fetch serves SPA, assets, and forwards API requests", async () => {
  const root = await fixture();
  const apiFetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      }),
  );
  const fetch = createDockerFetch(apiFetch, root);

  expect(await (await fetch(new Request("http://localhost/"))).text()).toContain("dashboard");
  expect(
    (await fetch(new Request("http://localhost/assets/app.js"))).headers.get("content-type"),
  ).toContain("text/javascript");
  expect((await fetch(new Request("http://localhost/positions"))).status).toBe(200);
  expect(await (await fetch(new Request("http://localhost/health"))).json()).toEqual({ ok: true });
  expect(apiFetch).toHaveBeenCalledOnce();
});

test("Docker fetch rejects traversal and serves SPA for missing client routes", async () => {
  const root = await fixture();
  const fetch = createDockerFetch(vi.fn(), root);

  expect((await fetch(new Request("http://localhost/%2e%2e%2fsecret"))).status).toBe(404);
  expect(await (await fetch(new Request("http://localhost/unknown-route"))).text()).toContain(
    "dashboard",
  );
});
