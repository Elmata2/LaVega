import { afterEach, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

afterEach(() => {
  vi.doUnmock("../archive");
  vi.resetModules();
});

const html = async () => {
  const { default: Import } = await import("./Import");
  return renderToStaticMarkup(
    <Import
      entity="Persoonlijk"
      onEntityChange={() => {}}
      busy={false}
      problems={[]}
      onRefreshBank={() => {}}
    />,
  );
};

test("the Entiteit field is hidden while the entity classifier is archived", async () => {
  expect(await html()).not.toMatch(/Entiteit|Entity/);
});

test("the Entiteit field shows when the entity classifier is on", async () => {
  vi.resetModules();
  vi.doMock("../archive", async (orig) => ({
    ...(await orig<typeof import("../archive")>()),
    SHOW_ENTITY_CLASSIFIER: true,
  }));
  expect(await html()).toMatch(/Entiteit|Entity/);
});
