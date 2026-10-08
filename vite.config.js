import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    allowedHosts: [
      "communities-rom-hospitality-gui.trycloudflare.com"
    ]
  }
});