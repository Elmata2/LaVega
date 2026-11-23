import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Button, Card, CardHeader, CardTitle, cn, Field, Input, Label } from "./index.js";

describe("@lavega/ui", () => {
  test("cn merges conflicting Tailwind classes", () => {
    expect(cn("px-2 text-red-500", "px-4")).toBe("text-red-500 px-4");
  });

  test("renders shared primitives under React 19", () => {
    const html = renderToStaticMarkup(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
        </CardHeader>
        <Field>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" />
        </Field>
        <Button type="button">Save</Button>
      </Card>,
    );
    expect(html).toContain("Title");
    expect(html).toContain('for="email"');
    expect(html).toContain('type="email"');
    expect(html).toContain(">Save</button>");
  });
});
