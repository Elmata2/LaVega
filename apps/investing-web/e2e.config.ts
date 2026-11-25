import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";

export default {
  targets: [
    {
      engine: web(),
      app: {
        url: process.env.APP_URL ?? "http://localhost:5173",
        command: {
          executable: "bun",
          args: ["run", "dev", "--", "--port", "5173", "--strictPort"],
          reuseExisting: true,
        },
      },
    },
  ],
} satisfies E2EConfig;
