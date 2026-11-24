import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), ".gen", "live.json");

export type Live = {
  title: string;
  phase: string;
  since: number;
};

export function readLive(): Live | null {
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<Live>;
    if (!parsed.title || !parsed.phase || !parsed.since) return null;
    return { title: parsed.title, phase: parsed.phase, since: parsed.since };
  } catch {
    return null;
  }
}

export function setLive(phase: string, title?: string) {
  const current = readLive();
  const nextTitle = title ?? current?.title ?? "생성";
  const since = current && current.title === nextTitle ? current.since : Date.now();
  mkdirSync(path.dirname(file), { recursive: true });
  const body: Live = { title: nextTitle, phase, since };
  writeFileSync(file, `${JSON.stringify(body)}\n`, "utf8");
}

export function clearLive() {
  if (existsSync(file)) unlinkSync(file);
}
