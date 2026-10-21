import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The daemon serves only the files named in dist/ui-app/asset-list.json (scripts/build-ui.mjs).
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/ui/app/",
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("../dist/ui-app", import.meta.url)),
    emptyOutDir: true,
    // CSP has no data:/blob: sources; every asset must be a separate same-origin file.
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    sourcemap: false,
  },
});
