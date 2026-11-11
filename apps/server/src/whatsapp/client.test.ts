import { expect, test, vi } from "vitest";
import { createWhatsAppClient, WindowClosedError, WINDOW_MS } from "./client.js";

const ok = () => new Response(JSON.stringify({ messages: [{ id: "wamid.OUT" }] }), { status: 200 });
const setup = () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => ok());
  const client = createWhatsAppClient({ phoneNumberId: "123", accessToken: "tok" }, fetchImpl);
  return { fetchImpl, client };
};
const sent = (f: ReturnType<typeof setup>["fetchImpl"]) =>
  JSON.parse(String(f.mock.calls[0]![1]!.body));

test("sendText with a closed or unknown window throws WindowClosedError and never calls fetch", async () => {
  const { fetchImpl, client } = setup();
  const now = 10 * WINDOW_MS;
  await expect(client.sendText("31600000000", "hi", null, now)).rejects.toBeInstanceOf(
    WindowClosedError,
  );
  await expect(
    client.sendText("31600000000", "hi", now - WINDOW_MS - 1, now),
  ).rejects.toBeInstanceOf(WindowClosedError);
  expect(fetchImpl).not.toHaveBeenCalled();
});

test("sendText inside the window posts the text", async () => {
  const { fetchImpl, client } = setup();
  const now = 10 * WINDOW_MS;
  expect(await client.sendText("31600000000", "hi", now - 1000, now)).toEqual({
    wamid: "wamid.OUT",
  });
  expect(fetchImpl.mock.calls[0]![0]).toContain("/123/messages");
  expect(sent(fetchImpl)).toMatchObject({ to: "31600000000", type: "text", text: { body: "hi" } });
  expect(fetchImpl.mock.calls[0]![1]!.headers).toMatchObject({ authorization: "Bearer tok" });
});

test("sendTemplate posts the template name, language and only the given variables", async () => {
  const { fetchImpl, client } = setup();
  await client.sendTemplate("31600000000", "daily_v1", "nl", ["A", "B"]);
  expect(sent(fetchImpl).template).toEqual({
    name: "daily_v1",
    language: { code: "nl" },
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: "A" },
          { type: "text", text: "B" },
        ],
      },
    ],
  });
});

test("sendTemplate with no variables sends no components", async () => {
  const { fetchImpl, client } = setup();
  await client.sendTemplate("31600000000", "daily_v1", "en", []);
  expect(sent(fetchImpl).template.components).toBeUndefined();
});

test("sendButtons posts reply buttons", async () => {
  const { fetchImpl, client } = setup();
  await client.sendButtons("31600000000", "ok?", [{ id: "y", title: "Ja" }]);
  expect(sent(fetchImpl).interactive.action.buttons).toEqual([
    { type: "reply", reply: { id: "y", title: "Ja" } },
  ]);
});

test("a failed send throws an error that carries the status and no body", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response("secret detail", { status: 400 }));
  const client = createWhatsAppClient({ phoneNumberId: "1", accessToken: "t" }, fetchImpl);
  const error = await client.sendTemplate("3", "n", "nl", []).catch((e: Error) => e);
  expect((error as Error).message).toBe("WhatsApp send failed with status 400");
});
