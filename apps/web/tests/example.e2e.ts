import { test } from "@e2e-dev/web";
import { expect } from "e2e";

test("preview app dismisses intake prompt and navigates", async ({ app, screen }) => {
  await app.open("/app");

  const later = screen.getByRole("button", { name: "Later" });
  await expect(later).toBeVisible();
  await later.click();

  await expect(screen.getByRole("navigation")).toBeVisible();
  await app.open("/app/transactions");
  await expect(screen.getByRole("heading", { name: /Transactions/i }).first()).toBeVisible();
});
