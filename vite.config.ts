import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  publicDir: "../public",
  build: {
    target: "es2022",
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: false,
  },
  worker: { format: "es" },
});
