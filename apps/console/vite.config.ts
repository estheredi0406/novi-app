import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The MFI console (Sprint 5.4). In development, Vite serves it on port 5173
// and passes every /v1 request to the API on port 3000, so the browser sees
// one address and the API needs no cross-origin settings.
export default defineConfig({
  plugins: [react()],
  // Online, the API serves the built console at /console (D58).
  base: "/console/",
  server: {
    port: 5173,
    proxy: { "/v1": "http://localhost:3000" },
  },
});
