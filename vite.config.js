import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    allowedHosts: [
      "stays-wishlist-unlike-fellowship.trycloudflare.com"
    ]
  }
});