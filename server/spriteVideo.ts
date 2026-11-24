import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import { characterPath } from "./cursorImage";
import { buildOptions } from "./matteOptions";
import { finishFrames } from "./pipeline";
import { MOTION_MAX_SECONDS, MOTION_MIN_SECONDS } from "../src/methods";

const genDir = path.resolve(process.cwd(), ".gen");

export const takePath = path.join(genDir, "performance", "take.mp4");

export type ClipKind = "performance" | "puppet";

function motionIdOk(motion: string) {
  return /^[A-Za-z0-9_-]{1,40}$/.test(motion) && motion !== "take";
}

export const WORK_ID = "current";

export function clipPath(kind: ClipKind, motion: string) {
  if (!motionIdOk(motion)) return "";
  return path.join(genDir, kind, `${motion}.mp4`);
}

export function workingClip(kind: ClipKind) {
  const current = clipPath(kind, WORK_ID);
  if (current && existsSync(current)) return current;
  const dir = path.join(genDir, kind);
  if (!existsSync(dir)) return "";
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".mp4"))
    .map((name) => ({ motion: name.replace(/\.mp4$/, ""), file: path.join(dir, name) }))
    .filter((item) => motionIdOk(item.motion) && existsSync(item.file))
    .sort((a, b) => statSync(b.file).mtimeMs - statSync(a.file).mtimeMs);
  return files[0]?.file ?? "";
}

export function workingSeconds(kind: ClipKind) {
  const file = workingClip(kind);
  if (!file) return 0;
  return clipMeta(file).seconds;
}

export function savedMotions(kind: ClipKind) {
  const dir = path.join(genDir, kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".mp4") && motionIdOk(name.replace(/\.mp4$/, "")))
    .map((name) => name.replace(/\.mp4$/, ""))
    .sort();
}

function run(bin: string, args: string[]) {
  return new Promise<{ code: number; stdout: Buffer; stderr: string }>((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("영상에서 칸을 꺼내는 시간이 초과되었습니다."));
    }, 60_000);
    child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: Buffer.concat(chunks), stderr });
    });
  });
}

export async function clipDuration(file: string) {
  if (!ffmpegPath) throw new Error("영상 길이를 읽을 ffmpeg가 없습니다.");
  return duration(ffmpegPath, file);
}

function clipMeta(file: string) {
  const metaPath = file.replace(/\.mp4$/, ".json");
  if (!existsSync(metaPath)) return { seconds: 0, body: false };
  try {
    const parsed = JSON.parse(readFileSync(metaPath, "utf8")) as { seconds?: number; body?: boolean };
    return {
      seconds: typeof parsed.seconds === "number" && Number.isFinite(parsed.seconds) ? parsed.seconds : 0,
      body: parsed.body === true,
    };
  } catch {
    return { seconds: 0, body: false };
  }
}

export function clipSeconds(kind: ClipKind) {
  const seconds: Record<string, number> = {};
  for (const motion of savedMotions(kind)) {
    const file = clipPath(kind, motion);
    if (!file || !existsSync(file)) continue;
    const meta = clipMeta(file);
    if (meta.seconds > 0) seconds[motion] = meta.seconds;
  }
  return seconds;
}

function usable(seconds: number) {
  return seconds >= MOTION_MIN_SECONDS && seconds <= MOTION_MAX_SECONDS;
}

export function motionSource(source: "pose" | "puppet", prefer: "puppet" | "take" = "puppet") {
  const specific = workingClip(source === "pose" ? "performance" : "puppet");
  const clipReady = Boolean(specific && existsSync(specific) && usable(clipMeta(specific).seconds));
  if (source === "pose") return clipReady ? specific : "";
  const uploaded = performanceMeta();
  const takeReady = uploaded.ready && usable(uploaded.seconds);
  if (prefer === "take" && takeReady) return takePath;
  if (clipReady) return specific;
  return takeReady ? takePath : "";
}

export async function usePuppet(folder: string, motion: string) {
  if (!/^puppet-\d+$/.test(folder)) throw new Error("인형 영상 폴더 이름이 올바르지 않습니다.");
  const source = path.join(genDir, folder, "generated.mp4");
  const destination = clipPath("puppet", motion);
  if (!existsSync(source)) throw new Error("인형 영상을 찾지 못했습니다.");
  if (!destination) throw new Error("동작 이름이 올바르지 않습니다.");
  const seconds = await clipDuration(source);
  if (!usable(seconds)) throw new Error(`인형 영상이 ${seconds.toFixed(1)}초입니다. Motion Control은 ${MOTION_MIN_SECONDS}초 이상 ${MOTION_MAX_SECONDS}초 이하만 받습니다.`);
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  writeFileSync(destination.replace(/\.mp4$/, ".json"), JSON.stringify({ seconds, from: folder }));
  return { seconds };
}

export function puppetCandidates(motion: string) {
  if (!existsSync(genDir)) return [];
  return readdirSync(genDir)
    .filter((name) => /^puppet-\d+$/.test(name) && existsSync(path.join(genDir, name, "generated.mp4")) && existsSync(path.join(genDir, name, "prompt.txt")))
    .filter((name) => readFileSync(path.join(genDir, name, "prompt.txt"), "utf8").match(/^Motion:\s*([A-Za-z0-9_-]+)/m)?.[1] === motion)
    .sort()
    .reverse()
    .slice(0, 6);
}

const MOTION_MIN_SIDE = 512;
const MOTION_FIT_SIDE = 520;
const MOTION_MAX_SIDE = 2160;

async function duration(bin: string, file: string) {
  const probe = await run(bin, ["-i", file]);
  const match = probe.stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) throw new Error("영상 길이를 읽지 못했습니다.");
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function videoSize(stderr: string) {
  const match = stderr.match(/,\s*(\d+)x(\d+)(?:[\s,]|$)/);
  if (!match) throw new Error("영상 크기를 읽지 못했습니다.");
  return { width: Number(match[1]), height: Number(match[2]) };
}

function motionCanvas(width: number, height: number) {
  let scale = 1;
  if (width < MOTION_MIN_SIDE || height < MOTION_MIN_SIDE) scale = Math.max(MOTION_FIT_SIDE / width, MOTION_FIT_SIDE / height);
  if (width * scale > MOTION_MAX_SIDE || height * scale > MOTION_MAX_SIDE) scale = Math.min(MOTION_MAX_SIDE / width, MOTION_MAX_SIDE / height);
  const even = (value: number) => {
    let next = Math.max(2, Math.min(MOTION_MAX_SIDE, Math.round(value)));
    if (next % 2) next += next < MOTION_MAX_SIDE ? 1 : -1;
    return next;
  };
  return {
    width: Math.max(width < MOTION_MIN_SIDE ? MOTION_FIT_SIDE : MOTION_MIN_SIDE, even(width * scale)),
    height: Math.max(height < MOTION_MIN_SIDE ? MOTION_FIT_SIDE : MOTION_MIN_SIDE, even(height * scale)),
  };
}

export async function prepareMotionVideo(source: string, destination: string) {
  if (!ffmpegPath) throw new Error("영상을 맞출 ffmpeg가 없습니다.");
  const probe = await run(ffmpegPath, ["-i", source]);
  const size = videoSize(probe.stderr);
  const fitted = motionCanvas(size.width, size.height);
  if (fitted.width === size.width && fitted.height === size.height) return source;
  const result = await run(ffmpegPath, [
    "-y", "-i", source,
    "-vf", `scale=${fitted.width}:${fitted.height}:force_original_aspect_ratio=decrease,pad=${fitted.width}:${fitted.height}:(ow-iw)/2:(oh-ih)/2:black`,
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    destination,
  ]);
  if (result.code !== 0) throw new Error("동작 영상을 Kling이 받는 크기로 맞추지 못했습니다.");
  return destination;
}

async function frameAt(bin: string, file: string, time: number) {
  const result = await run(bin, [
    "-ss", time.toFixed(3),
    "-i", file,
    "-frames:v", "1",
    "-f", "image2",
    "-vcodec", "png",
    "pipe:1",
  ]);
  if (!result.stdout.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("영상 칸을 PNG로 꺼내지 못했습니다.");
  }
  return result.stdout;
}

export async function spriteFromVideo(video: string, count: number) {
  if (!ffmpegPath) throw new Error("칸을 꺼낼 ffmpeg가 없습니다.");
  if (!existsSync(video)) throw new Error("만든 영상이 없습니다. 먼저 영상 테스트를 해 주세요.");
  const framesWanted = Math.max(4, Math.min(12, Math.round(count)));
  const length = await duration(ffmpegPath, video);
  const times = Array.from({ length: framesWanted }, (_, index) => (length * (index + 0.5)) / framesWanted);
  const raw = [];
  for (const time of times) raw.push(await frameAt(ffmpegPath, video, time));

  const folder = path.dirname(video);
  const rawDir = path.join(folder, "frames");
  const spriteDir = path.join(folder, "sprites");
  mkdirSync(rawDir, { recursive: true });
  mkdirSync(spriteDir, { recursive: true });
  raw.forEach((frame, index) => writeFileSync(path.join(rawDir, `frame_${String(index).padStart(2, "0")}.png`), frame));

  const promptPath = path.join(folder, "prompt.txt");
  const prompt = existsSync(promptPath) ? readFileSync(promptPath, "utf8") : "";
  const motion = prompt.match(/^Motion:\s*([A-Za-z0-9_-]+)/m)?.[1] ?? "sprite";
  const palette = existsSync(characterPath) ? readFileSync(characterPath) : undefined;
  const finished = await finishFrames(raw, palette);
  finished.frames.forEach((frame, index) => {
    writeFileSync(path.join(spriteDir, `${motion}_${String(index).padStart(2, "0")}.png`), frame);
  });
  writeFileSync(path.join(spriteDir, "sheet.png"), finished.sheet);
  return { motion, folder: path.basename(folder), raw: raw[0], finished };
}

function spriteNames(folder: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(folder)) throw new Error("결과를 찾지 못했습니다.");
  const spriteDir = path.join(genDir, folder, "sprites");
  if (!existsSync(spriteDir)) throw new Error("저장된 칸이 없습니다.");
  const names = readdirSync(spriteDir)
    .filter((name) => /^[A-Za-z0-9_-]+_\d+\.png$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!names.length) throw new Error("저장된 칸이 없습니다.");
  return { spriteDir, names };
}

function untouchedFrames(folder: string, count: number) {
  const frameDir = path.join(genDir, folder, "frames");
  if (!existsSync(frameDir)) return null;
  const names = readdirSync(frameDir)
    .filter((name) => /^frame_\d+\.png$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (names.length !== count) return null;
  return names.map((name) => readFileSync(path.join(frameDir, name)));
}

export async function buildMatteOptions(folder: string) {
  const { spriteDir, names } = spriteNames(folder);
  const sprites = names.map((name) => readFileSync(path.join(spriteDir, name)));
  const made = await buildOptions(sprites, untouchedFrames(folder, names.length) ?? sprites);
  const matteDir = path.join(genDir, folder, "matte");
  mkdirSync(path.join(matteDir, "a"), { recursive: true });
  made.a.forEach((frame, index) => writeFileSync(path.join(matteDir, "a", `${index}.png`), frame));
  if (made.b) {
    mkdirSync(path.join(matteDir, "b"), { recursive: true });
    made.b.forEach((frame, index) => writeFileSync(path.join(matteDir, "b", `${index}.png`), frame));
  }
  mkdirSync(path.join(matteDir, "c"), { recursive: true });
  made.c.forEach((frame, index) => writeFileSync(path.join(matteDir, "c", `${index}.png`), frame));
  mkdirSync(path.join(matteDir, "d"), { recursive: true });
  made.d.forEach((frame, index) => writeFileSync(path.join(matteDir, "d", `${index}.png`), frame));
  writeFileSync(path.join(matteDir, "order.json"), JSON.stringify(names));
  writeFileSync(path.join(matteDir, "compare.png"), made.compare);
  const stamp = Date.now();
  return {
    compare: `/api/file?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent("matte/compare.png")}&t=${stamp}`,
    aHow: made.aHow,
    bHow: made.bHow,
    cHow: made.cHow,
    dHow: made.dHow,
    hasB: Boolean(made.b),
  };
}

export async function chooseMatte(folder: string, choice: string) {
  if (choice !== "a" && choice !== "b" && choice !== "c" && choice !== "d") throw new Error("A, B, C, D 중에서 고르세요.");
  const { spriteDir } = spriteNames(folder);
  const matteDir = path.join(genDir, folder, "matte");
  const orderPath = path.join(matteDir, "order.json");
  if (!existsSync(orderPath)) throw new Error("먼저 배경 투명화로 비교를 만드세요.");
  const names = JSON.parse(readFileSync(orderPath, "utf8")) as string[];
  if (!Array.isArray(names) || names.some((name) => !/^[A-Za-z0-9_-]+_\d+\.png$/.test(name))) {
    throw new Error("투명화 순서를 읽지 못했습니다.");
  }
  const frames = names.map((_, index) => {
    const file = path.join(matteDir, choice, `${index}.png`);
    if (!existsSync(file)) throw new Error(`${choice.toUpperCase()}를 만들지 못했습니다.`);
    return readFileSync(file);
  });
  frames.forEach((frame, index) => writeFileSync(path.join(spriteDir, names[index]), frame));
  const meta = await Promise.all(frames.map(async (frame) => sharp(frame).metadata()));
  let left = 0;
  const placed = meta.map((info, index) => {
    const item = { input: frames[index], left, top: 0 };
    left += info.width ?? 1;
    return item;
  });
  const sheet = await sharp({
    create: {
      width: Math.max(1, left),
      height: Math.max(1, ...meta.map((info) => info.height ?? 1)),
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(placed).png().toBuffer();
  writeFileSync(path.join(spriteDir, "sheet.png"), sheet);
  const stamp = Date.now();
  const fileUrl = (name: string) => `/api/file?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(`sprites/${name}`)}&t=${stamp}`;
  return {
    frames: names.map(fileUrl),
    sheet: fileUrl("sheet.png"),
    notes: [
      choice === "a" ? "A 테두리 색으로 배경을 지움" : choice === "b" ? "B rembg로 배경을 지움" : choice === "c" ? "C 원래 방식으로 배경을 지움" : "D 배경을 그대로 둠",
      `칸 ${names.length}장`,
    ],
  };
}

async function matchFrameSize(frames: Buffer[]) {
  const metas = await Promise.all(frames.map((frame) => sharp(frame).metadata()));
  const width = Math.max(...metas.map((meta) => meta.width ?? 0));
  const height = Math.max(...metas.map((meta) => meta.height ?? 0));
  if (width < 1 || height < 1) throw new Error("그림 크기를 읽지 못했습니다.");
  if (metas.every((meta) => meta.width === width && meta.height === height)) return frames;
  return Promise.all(frames.map((frame) => sharp(frame).resize(width, height, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 1 },
  }).png().toBuffer()));
}

export async function writePuppetSequence(motion: string, frames: Buffer[]) {
  const count = frames.length;
  if (count < 2 || count > 8) throw new Error("회색 인형은 2장에서 8장까지입니다.");
  const matched = await matchFrameSize(frames);
  frames = matched;
  const destination = clipPath("puppet", motion);
  if (!destination) throw new Error("동작 이름이 올바르지 않습니다.");
  const fps = 12;
  const total = fps * MOTION_MIN_SECONDS;
  const base = Math.floor(total / count);
  const extra = total % count;
  const held: Buffer[] = [];
  frames.forEach((frame, index) => {
    const copies = base + (index < extra ? 1 : 0);
    for (let copy = 0; copy < copies; copy += 1) held.push(frame);
  });
  await writeClip(held, destination, fps);
  const seconds = await clipDuration(destination);
  if (!usable(seconds)) throw new Error(`인형 영상이 ${seconds.toFixed(1)}초입니다. Motion Control은 ${MOTION_MIN_SECONDS}초 이상 ${MOTION_MAX_SECONDS}초 이하만 받습니다.`);
  writeFileSync(destination.replace(/\.mp4$/, ".json"), JSON.stringify({ seconds, stills: count }));
  return { seconds };
}

export async function writeClip(frames: Buffer[], destination: string, fps = 12) {
  if (!ffmpegPath) throw new Error("영상을 저장할 ffmpeg가 없습니다.");
  mkdirSync(path.dirname(destination), { recursive: true });
  const dir = path.join(path.dirname(destination), "encode");
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) {
    if (/^clip_\d+\.png$/.test(name)) unlinkSync(path.join(dir, name));
  }
  frames.forEach((frame, index) => writeFileSync(path.join(dir, `clip_${String(index).padStart(2, "0")}.png`), frame));
  const result = await run(ffmpegPath, [
    "-y",
    "-framerate", String(fps),
    "-i", path.join(dir, "clip_%02d.png"),
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    destination,
  ]);
  if (result.code !== 0 || !existsSync(destination)) {
    throw new Error("로컬 영상을 인코딩하지 못했습니다.");
  }
}

export async function storePerformance(bytes: Buffer) {
  if (!ffmpegPath) throw new Error("영상 길이를 읽을 ffmpeg가 없습니다.");
  const dir = path.dirname(takePath);
  mkdirSync(dir, { recursive: true });
  const incoming = path.join(dir, "incoming.mp4");
  writeFileSync(incoming, bytes);
  const length = await duration(ffmpegPath, incoming);
  if (!Number.isFinite(length) || length <= 0) throw new Error("영상 길이를 읽지 못했습니다.");
  const trimmed = length > MOTION_MAX_SECONDS;
  let seconds = trimmed ? MOTION_MAX_SECONDS - 1 : length;
  let extendedFrom = 0;
  if (length < MOTION_MIN_SECONDS) {
    const target = MOTION_MIN_SECONDS + 0.05;
    const result = await run(ffmpegPath, [
      "-y", "-i", incoming,
      "-filter:v", `setpts=${(target / length).toFixed(6)}*PTS,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
      takePath,
    ]);
    if (result.code !== 0) throw new Error("짧은 영상을 3초로 늘리지 못했습니다.");
    seconds = await duration(ffmpegPath, takePath);
    if (seconds < MOTION_MIN_SECONDS) throw new Error(`늘린 영상이 ${seconds.toFixed(1)}초입니다. 3초로 맞추지 못했습니다.`);
    extendedFrom = length;
  } else if (trimmed) {
    const result = await run(ffmpegPath, [
      "-y", "-i", incoming, "-t", String(MOTION_MAX_SECONDS - 1), "-an",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
      takePath,
    ]);
    if (result.code !== 0) throw new Error(`${MOTION_MAX_SECONDS}초가 넘는 영상을 앞 ${MOTION_MAX_SECONDS - 1}초로 자르지 못했습니다.`);
  } else {
    copyFileSync(incoming, takePath);
  }
  writeFileSync(path.join(dir, "meta.json"), `${JSON.stringify({ seconds, trimmed, extendedFrom }, null, 2)}\n`);
  return { seconds, trimmed, extendedFrom };
}

export function performanceMeta() {
  const metaPath = path.join(path.dirname(takePath), "meta.json");
  if (!existsSync(takePath) || !existsSync(metaPath)) return { ready: false, seconds: 0, trimmed: false, extendedFrom: 0 };
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { seconds?: number; trimmed?: boolean; extendedFrom?: number };
    const seconds = Number(meta.seconds ?? 0);
    const extendedFrom = Number(meta.extendedFrom ?? 0);
    return { ready: usable(seconds), seconds, trimmed: Boolean(meta.trimmed), extendedFrom: Number.isFinite(extendedFrom) ? extendedFrom : 0 };
  } catch {
    return { ready: false, seconds: 0, trimmed: false, extendedFrom: 0 };
  }
}
