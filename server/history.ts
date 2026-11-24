import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
const genDir = path.resolve(process.cwd(), ".gen");

const modelSources: Record<string, string> = {
  "fal-ai/kling-video/v3/standard/image-to-video": "kling",
  "fal-ai/kling-video/v3/pro/image-to-video": "kling",
  "fal-ai/kling-video/v3/standard/motion-control": "pose",
  "luma/agent/ray/v3.2/image-to-video": "luma",
  "fal-ai/minimax/hailuo-02/standard/image-to-video": "hailuo",
  "fal-ai/wan-22-vace-fun-a14b/pose": "wan",
  "minimax/h3-max/3d-to-video": "h3",
  "fal-ai/flux-general": "fal-pose",
};

export type HistoryItem = {
  number: number;
  at: number;
  folder: string;
  source: string;
  motion: string;
  frames: string[];
  sheet: string;
  video: string;
  prompt: string;
  sourceWidth: number;
  sourceHeight: number;
  cellWidth: number;
  cellHeight: number;
};

function fileUrl(folder: string, name: string) {
  return `/api/file?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(name)}`;
}

function folderTime(name: string, dir: string) {
  const match = name.match(/(\d{13})/);
  if (match) return Number(match[1]);
  return statSync(dir).mtimeMs;
}

function readPrompt(dir: string) {
  const file = path.join(dir, "prompt.txt");
  if (!existsSync(file)) return "";
  return readFileSync(file, "utf8").trim();
}

function readMotion(dir: string) {
  const match = readPrompt(dir).match(/^Motion:\s*([A-Za-z0-9_-]+)/m);
  return match?.[1] ?? "";
}

function readFit(dir: string) {
  const empty = { sourceWidth: 0, sourceHeight: 0, cellWidth: 0, cellHeight: 0 };
  const file = path.join(dir, "sprites", "fit.json");
  if (!existsSync(file)) return empty;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<typeof empty>;
    return {
      sourceWidth: Number(parsed.sourceWidth ?? 0) || 0,
      sourceHeight: Number(parsed.sourceHeight ?? 0) || 0,
      cellWidth: Number(parsed.cellWidth ?? 0) || 0,
      cellHeight: Number(parsed.cellHeight ?? 0) || 0,
    };
  } catch {
    return empty;
  }
}

function readJob(dir: string) {
  const file = path.join(dir, "job.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as { model?: string; source?: string };
  } catch {
    return {};
  }
}

function pngNames(dir: string, pattern: RegExp) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => pattern.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function listHistory(): HistoryItem[] {
  if (!existsSync(genDir)) return [];
  const found: Omit<HistoryItem, "number">[] = [];
  for (const name of readdirSync(genDir)) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) continue;
    const dir = path.join(genDir, name);
    if (!statSync(dir).isDirectory()) continue;
    const video = existsSync(path.join(dir, "generated.mp4"));
    const still = existsSync(path.join(dir, "generated.png"));
    const strip = existsSync(path.join(dir, "strip.png"));
    if (!video && !still && !strip) continue;
    const job = readJob(dir);
    const source = job.source
      ?? modelSources[job.model ?? ""]
      ?? (strip ? "cursor" : still ? "fal-pose" : "video");
    const sprites = pngNames(path.join(dir, "sprites"), /^[A-Za-z0-9_-]+_\d+\.png$/);
    const frames = pngNames(path.join(dir, "frames"), /^frame_\d+\.png$/);
    const pictures = sprites.length
      ? sprites.map((file) => fileUrl(name, `sprites/${file}`))
      : frames.length
        ? frames.map((file) => fileUrl(name, `frames/${file}`))
        : still
          ? [fileUrl(name, "generated.png")]
          : strip
            ? [fileUrl(name, "strip.png")]
            : [];
    const sheet = existsSync(path.join(dir, "sprites", "sheet.png")) ? fileUrl(name, "sprites/sheet.png") : "";
    const fit = readFit(dir);
    found.push({
      at: folderTime(name, dir),
      folder: name,
      source,
      motion: readMotion(dir),
      frames: pictures,
      sheet,
      video: video ? fileUrl(name, "generated.mp4") : "",
      prompt: readPrompt(dir),
      ...fit,
    });
  }
  return found
    .sort((a, b) => a.at - b.at)
    .map((item, index) => ({ ...item, number: index + 1 }))
    .sort((a, b) => b.at - a.at);
}

export function resolveGenFile(folder: string, name: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(folder)) return null;
  if (name.includes("\\") || name.split("/").includes("..")) return null;
  const library = folder === "characters" && (/^[A-Za-z0-9_-]+\/image\.png$/.test(name) || /^[^/]+\.(png|jpe?g|webp)$/i.test(name));
  if (!library && !/^(generated\.mp4|generated\.png|strip\.png|sprites\/[A-Za-z0-9_-]+\.png|frames\/frame_\d+\.png|matte\/compare\.png)$/.test(name)) return null;
  const full = path.resolve(genDir, folder, name);
  const relative = path.relative(genDir, full);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  if (!existsSync(full)) return null;
  return full;
}
