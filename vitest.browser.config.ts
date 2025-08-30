import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
  test: {
    browser: {
      enabled: true,
      provider: "playwright",
      // https://vitest.dev/guide/browser/playwright
      instances: [
        { browser: "chromium" },
        // { browser: "firefox" }
      ],
      headless: true,
    },
  },
});
