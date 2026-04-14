import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

/** Match dependency paths on Unix or Windows (Rollup may use either separator). */
function nodeModulesPathIncludes(id: string, relPath: string): boolean {
  const forward = `node_modules/${relPath}`;
  const backward = `node_modules\\${relPath.replace(/\//g, "\\")}`;
  return id.includes(forward) || id.includes(backward);
}

function manualChunks(id: string): string | undefined {
  if (!id.includes("node_modules")) {
    return undefined;
  }
  if (
    nodeModulesPathIncludes(id, "react-dom") ||
    nodeModulesPathIncludes(id, "react/") ||
    nodeModulesPathIncludes(id, "scheduler")
  ) {
    return "react-vendor";
  }
  if (id.includes("react-router")) {
    return "react-router";
  }
  if (id.includes("@tanstack/react-query")) {
    return "tanstack-query";
  }
  if (id.includes("@radix-ui")) {
    return "radix-ui";
  }
  if (id.includes("recharts")) {
    return "recharts";
  }
  if (id.includes("lucide-react")) {
    return "lucide";
  }
  if (id.includes("axios")) {
    return "axios";
  }
  if (id.includes("date-fns")) {
    return "date-fns";
  }
  if (id.includes("react-hook-form") || id.includes("@hookform") || id.includes("/zod/")) {
    return "forms";
  }
  return "vendor";
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 5173,
    strictPort: false,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
}));
