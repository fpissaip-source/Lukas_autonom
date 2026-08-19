import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// PORT/BASE_PATH kommen im Deployment aus der Umgebung; lokal gelten Defaults.
const port = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 5174;
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  root: path.resolve(import.meta.dirname),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: { port, host: "0.0.0.0", allowedHosts: true },
  preview: { port, host: "0.0.0.0", allowedHosts: true },
});
