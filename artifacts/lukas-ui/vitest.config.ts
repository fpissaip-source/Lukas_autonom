import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

/*
 * Eine eigene Konfiguration, nicht die von Vite mit einem Testblock daran.
 *
 * vite.config.ts laedt Replit-Plugins und Tailwind — im Test braucht das
 * niemand, und der Fehlerbildschirm-Overlay-Plugin haengt sich an ein
 * `window`, das es dort erst gibt, wenn jsdom hochgefahren ist. Zwei Dateien
 * sind hier ehrlicher als eine mit Bedingungen darin.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
    dedupe: ["react", "react-dom"],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
    css: false,
  },
});
