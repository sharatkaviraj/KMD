import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import { PORTED_TREES } from "./scripts/port-rewrite-imports.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    /*
     * Next 16 turns on the experimental React Compiler lint suite, and the
     * code ported from School Fees does not pass it: deliberate effect-driven
     * hydration, and mutable accumulators built during render. About ninety
     * findings across the Payment Desk, the student loader and the import
     * workspace.
     *
     * Those are real smells and they are also a year of tested behaviour at a
     * fee desk. Rewriting them inside a port is how a port becomes a rewrite,
     * and how a regression in collecting money gets blamed on a lint rule.
     *
     * **Scoped to the ported trees, not switched off globally** — which is
     * where this differs from the fee app's own config. This repo's code is
     * held to the rules; the code that arrived is held to the contract it was
     * written under, and the boundary between them is the same one list the
     * codemod and the architecture tests read. A file that leaves a ported
     * tree loses the exemption by moving.
     */
    files: PORTED_TREES.map((tree) => `${tree}/**/*.{ts,tsx}`),
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
