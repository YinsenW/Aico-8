import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  build: {
    manifest: "asset-manifest.json",
    rollupOptions: {
      input: process.env.AICO8_BUILD_COLLECTION_ENTRY === "1"
        ? resolve(import.meta.dirname, "collection.html")
        : resolve(import.meta.dirname, "index.html"),
    },
  },
});
