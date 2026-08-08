import { readFile } from "node:fs/promises";
import path from "node:path";
import typeIndex from "@/data/type-index.json";
import type { TypeProfile } from "./types";

export const TYPE_CODES = typeIndex.map((t) => t.type);

export function isTypeCode(value: string): boolean {
  return TYPE_CODES.includes(value.toUpperCase());
}

/**
 * Read a profile off disk at build time.
 *
 * The profiles live in `public/types/` so the browser can fetch one directly on
 * the result page, where the type is only known after the database responds.
 * Server pages read the same files rather than keeping a second copy in `src/`.
 * Server-only: this imports `node:fs`.
 */
export async function loadProfile(type: string): Promise<TypeProfile | null> {
  const code = type.toUpperCase();
  if (!isTypeCode(code)) return null;
  const file = path.join(process.cwd(), "public", "types", `${code}.json`);
  return JSON.parse(await readFile(file, "utf8")) as TypeProfile;
}
