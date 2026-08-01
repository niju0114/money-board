import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

/* 화면에서 어느 버전인지 바로 보이도록 빌드 스탬프를 주입한다 */
const commit = (() => {
  try {
    return execSync("git rev-parse --short=7 HEAD").toString().trim();
  } catch {
    return "unknown";
  }
})();
const builtAt = new Date().toISOString();

export default defineConfig({
  base: "/money-board/",
  define: {
    __BUILD_COMMIT__: JSON.stringify(commit),
    __BUILD_TIME__: JSON.stringify(builtAt)
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        id: "/money-board/",
        name: "내 돈",
        short_name: "내 돈",
        description: "개인 원장 — 하루 예산·가계부·계좌를 한 화면에",
        lang: "ko",
        start_url: "/money-board/",
        scope: "/money-board/",
        display: "standalone",
        theme_color: "#F2F2F7",
        background_color: "#F2F2F7",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        // 새 버전을 기다리지 않고 바로 넘긴다 — 폰에 옛 화면이 남는 걸 막는다
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // OAuth 콜백은 캐시된 index.html로 대체하지 않고 항상 네트워크로 보낸다
        navigateFallbackDenylist: [/[?&](code|state|error|error_description)=/]
      }
    })
  ]
});
