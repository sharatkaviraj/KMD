import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { PhotoAction } from "@/lib/ai/photo-schema";

const prompts = new Map<PhotoAction, Promise<string>>();
export function loadPhotoPrompt(action: PhotoAction) {
  const cached = prompts.get(action);
  if (cached) return cached;
  const loaded = readFile(path.join(process.cwd(), "src/lib/ai/prompts", action + ".md"), "utf8");
  prompts.set(action, loaded);
  void loaded.catch(() => { prompts.delete(action); });
  return loaded;
}
