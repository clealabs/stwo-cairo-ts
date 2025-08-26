import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [wasm(), topLevelAwait(), dts()],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "stwo-cairo",
      fileName: "stwo-cairo",
    },
  },
  worker: {
    plugins: () => [wasm(), topLevelAwait(), dts()],
  },
});
