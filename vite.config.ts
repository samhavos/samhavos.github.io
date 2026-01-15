import { defineConfig } from "vite";

export default defineConfig({
  root: "src",
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: "../docs",  // Github pages quirk (otherwise we have to dump everything into '/')
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: "src/index.html",
        new: "src/new/index.html"
      }
    }
  }
});
