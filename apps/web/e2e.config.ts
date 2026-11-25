import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";

export default {
  targets: [
    {
      engine: web(),
      app: {
        url: process.env.APP_URL ?? "http://127.0.0.1:5174",
        command: {
          executable: "bun",
          args: ["run", "dev:preview"],
          reuseExisting: true,
        },
      },
    },
  ],
} satisfies E2EConfig;
