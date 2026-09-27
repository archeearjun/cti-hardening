import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  publicDir: "../public",
  build: {
    target: "es2022",
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        main: "web/index.html",
        packageRunner: "web/package-runner.html",
      },
    },
  },
  worker: { format: "es" },
});
