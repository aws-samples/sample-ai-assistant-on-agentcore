import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [
    react({
      jsxRuntime: "automatic",
      jsxImportSource: "@emotion/react",
      babel: {
        plugins: ["@emotion/babel-plugin"],
      },
    }),
    {
      name: "dcv-worker-rewrite",
      configureServer(server) {
        // DCV SDK creates Blob workers that importScripts with page-relative paths.
        // Rewrite any request containing /dcvjs/ to serve from the root public dir.
        server.middlewares.use((req, _res, next) => {
          if (req.url && req.url.includes("/dcvjs/") && !req.url.startsWith("/dcvjs/")) {
            req.url = req.url.substring(req.url.indexOf("/dcvjs/"));
          }
          next();
        });
      },
    },
  ],
  root: ".",
  build: {
    outDir: "dist",
    sourcemap: true,
    chunkSizeWarningLimit: 2500,
    // Let Vite handle chunking automatically for proper dependency resolution
    rollupOptions: {},
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    extensions: [".js", ".jsx", ".json"],
  },
  optimizeDeps: {
    include: ["hoist-non-react-statics"],
  },
});
