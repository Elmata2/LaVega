import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Production all-in-one deploy serves this app under `/investing/` on lavega.dev.
  base: process.env.INVESTING_WEB_BASE ?? "/",
  plugins: [react()],
  server: {
    proxy: {
      "/health": "http://localhost:8788",
      "/api": "http://localhost:8788",
    },
  },
});
