import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export const WEB_PROXY_TARGETS = {
  api: "http://127.0.0.1:3010",
  kanban: "http://127.0.0.1:3012",
  chat: "http://127.0.0.1:3010",
} as const;

const proxy = {
  "/api": {
    target: WEB_PROXY_TARGETS.api,
    changeOrigin: true,
  },
  "/kanban-api": {
    target: WEB_PROXY_TARGETS.kanban,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/kanban-api/, "/api"),
  },
  "/chat-api": {
    target: WEB_PROXY_TARGETS.chat,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/chat-api/, "/api"),
  },
};

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ["@nexus/core"],
  },
  build: {
    commonjsOptions: {
      include: [/packages\/core/, /node_modules/],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@nexus/core": path.resolve(
        __dirname,
        "../../packages/core/src/browser.ts",
      ),
      "@nexus/kanban-contracts": path.resolve(
        __dirname,
        "../../packages/kanban-contracts/src/index.ts",
      ),
    },
  },
  server: {
    port: 3000,
    proxy,
  },
  preview: {
    host: "127.0.0.1",
    port: 3121,
    strictPort: true,
    proxy,
  },
});
