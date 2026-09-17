/**
 * Teach Node the `@/` alias, so a script can load app source directly.
 *
 * Node 24 runs TypeScript by stripping the types, which is enough for the
 * domain modules — they are logic and types and nothing else. What it does not
 * know is the `@/` path alias, which is a `tsconfig` idea and needs a bundler
 * to follow. Fifteen lines here mean `scripts/` can seed the database using
 * the app's *own* parser and engine rather than a copy of them that drifts.
 *
 * Imported for its side effect, and imported first: static imports are
 * evaluated in order and `registerHooks` is synchronous, so the hook is in
 * place before the aliased module is resolved.
 */

import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const srcRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src",
);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);

    const base = path.join(srcRoot, specifier.slice(2));
    // The app writes extensionless imports; TypeScript resolves them and Node
    // does not, so the candidates are tried here in the same order.
    const candidate = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find(
      (entry) => existsSync(entry) && !entry.endsWith(path.sep),
    );

    if (!candidate) {
      throw new Error(`Cannot resolve ${specifier} under ${srcRoot}`);
    }

    return { url: pathToFileURL(candidate).href, shortCircuit: true };
  },
});
