import { test } from "@e2e-dev/web";
import { expect } from "e2e";

test("investing overview, routes, position detail, and theme toggle work", async ({
  app,
  screen,
}) => {
  await app.open("/");
  const nav = screen.getByRole("navigation", { name: "Main navigation" });
  await expect(nav).toBeVisible();
  await expect(screen.getByRole("heading").first()).toBeVisible();

  // Navigate to Positions and open AAPL detail
  await screen.getByRole("link", { name: "Positions" }).click();
  await expect(screen.getByRole("heading", { name: "Positions" })).toBeVisible();
  await expect(screen.getByRole("table", { name: "Positions" })).toBeVisible();
  await screen.getByRole("link", { name: /AAPL/i }).click();
  await expect(screen.getByRole("heading", { name: /AAPL/i }).first()).toBeVisible();

  // Check remaining routes
  const routes = [
    { link: "Net worth", heading: /Net worth/i },
    { link: "Agents", heading: /Agents/i },
    { link: "Reports", heading: /Reports/i },
    { link: "Profile", heading: /Brokers/i },
  ];

  for (const { link, heading } of routes) {
    await screen.getByRole("link", { name: link }).click();
    await expect(screen.getByRole("heading", { name: heading }).first()).toBeVisible();
  }

  // Check stock research route
  await app.open("/agents/research");
  await expect(
    screen.getByRole("heading", { name: /One company\. Six perspectives\./i }),
  ).toBeVisible();

  // Toggle theme switch
  const themeSwitch = screen.getByRole("switch", { name: /theme/i });
  await expect(themeSwitch).toBeVisible();
  await themeSwitch.click();
});
