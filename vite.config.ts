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
    {
      name: "dev-headers",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
          res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
          res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
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
    format: "es", // TODO: uncomment for Firefox support (right now causes build error)
  },
});
