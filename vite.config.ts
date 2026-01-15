import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    rollupOptions: {
      input: {
        index: "src/public/index.html",
        new: "src/public/new/index.html"
      }
    }
  }
});
