import path from "node:path";
import { defineConfig, mergeConfig, type Plugin } from "vite";

import base from "./vite.config";

/*
 * The design fidelity fixture's server (`design.html`). Production client
 * screens import their server actions directly; in a browser with no server
 * those are replaced by stubs that resolve with nothing, so a screen draws
 * exactly as it would and no button can reach a database. `server-only`
 * becomes an empty module for the same reason.
 */
function stubServerModules(): Plugin {
  return {
    name: "vx-design-stub-server",
    enforce: "pre",
    resolveId(source) {
      if (source === "server-only") return "\0server-only";
      return null;
    },
    load(id) {
      if (id === "\0server-only") return "export {};";
      return null;
    },
    transform(code, id) {
      if (!/\.(t|j)sx?$/.test(id) || id.includes("node_modules")) return null;
      if (!/^\s*["']use server["'];?/.test(code)) return null;
      const names = new Set<string>();
      for (const match of code.matchAll(/export\s+(?:async\s+)?(?:function\s*\*?|const|let)\s+([A-Za-z0-9_$]+)/g)) names.add(match[1]);
      const lines = [...names].map((name) => `export async function ${name}() { console.info("[fixture] server action", ${JSON.stringify(name)}); return undefined; }`);
      return { code: lines.join("\n") || "export {};", map: null };
    },
  };
}

export default mergeConfig(base, defineConfig({
  plugins: [stubServerModules()],
  resolve: { alias: { "@": path.resolve(__dirname, "../../src") } },
  server: { port: 3202 },
}));
