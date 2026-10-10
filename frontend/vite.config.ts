/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": process.env.HOLOFORGE_API_URL ?? "http://localhost:8000" },
  },
  test: {
    environment: "node",
    passWithNoTests: true,
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
  },
});
