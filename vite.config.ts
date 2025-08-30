import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [
    wasm(),
    dts(),
    {
      name: "dev-headers", // we need this plugin because of a Vite bug: https://github.com/vitest-dev/vitest/issues/3743#issuecomment-1902261180
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
          res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
          next();
        });
      },
    },
  ],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "stwo-cairo",
      fileName: "stwo-cairo",
    },
  },
  worker: {
    plugins: () => [wasm()],
    format: "es",
  },
});
