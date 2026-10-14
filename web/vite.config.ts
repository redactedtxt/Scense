import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In Docker the API is at http://api:3000; on a bare laptop it is on localhost.
const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: { "/api": apiTarget },
    // Bind mounts from Windows/macOS don't deliver file events, so poll in Docker.
    watch: process.env.CHOKIDAR_USEPOLLING ? { usePolling: true } : undefined,
  },
});
