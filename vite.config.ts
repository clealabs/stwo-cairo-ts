import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait(),
    dts(),
    // https://medium.com/@pigeoncodeur/self-hosting-webassembly-app-in-js-13c3e7ff4748
    {
      name: "dev-headers-every-response",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // required for SharedArrayBuffer / cross-origin isolation
          res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
          res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
          // ensure assets (worker modules, wasm) are allowed
          res.setHeader("Cross-Origin-Resource-Policy", "same-origin");

          // optional: prevent caching while developing to avoid 304 issues
          // res.setHeader("Cache-Control", "no-store");
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
    rollupOptions: {
      output: {
        dir: resolve(__dirname, "dist"), // ensure this is a string, plugin expects it
      },
    },
  },
  worker: {
    plugins: () => [wasm(), topLevelAwait()],
    format: "es",
  },
  // server: {
  //   headers: {
  //     "Cross-Origin-Opener-Policy": "same-origin",
  //     "Cross-Origin-Embedder-Policy": "require-corp",
  //     "Cross-Origin-Resource-Policy": "same-origin",
  //   },
  // },
});
