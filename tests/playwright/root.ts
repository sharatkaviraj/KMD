import path from "node:path";

// These configs live in tests/playwright/ but every path in them is written
// from the repository root, as it was when they sat at the top level.
export const ROOT = path.resolve(__dirname, "../..");
export const fromRoot = (p: string) => path.resolve(ROOT, p);
