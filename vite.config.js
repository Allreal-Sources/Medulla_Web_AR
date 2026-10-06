import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    allowedHosts: [
      "dpi-suggesting-hitachi-structures.trycloudflare.com"
    ]
  }
});