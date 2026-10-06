import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    allowedHosts: [
      "novel-tons-retrieved-reported.trycloudflare.com"
    ]
  }
});