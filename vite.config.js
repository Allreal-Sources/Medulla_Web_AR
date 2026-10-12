import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    allowedHosts: [
      "issn-acute-ant-cooler.trycloudflare.com"
    ]
  }
});