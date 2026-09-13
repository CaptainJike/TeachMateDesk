import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8003,
    proxy: {
      "/api": {
        target: "http://localhost:8004",
        changeOrigin: true,
      },
      "/files": {
        target: "http://localhost:8002",
        changeOrigin: true,
      },
    },
  },
});
