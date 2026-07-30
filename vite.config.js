import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/money-board/",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        id: "/money-board/",
        name: "민준의 돈",
        short_name: "민준의 돈",
        description: "개인 원장 — 주간 예산·가계부·계좌를 한 화면에",
        lang: "ko",
        start_url: "/money-board/",
        scope: "/money-board/",
        display: "standalone",
        theme_color: "#2E5C46",
        background_color: "#EFF2EC",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"]
      }
    })
  ]
});
