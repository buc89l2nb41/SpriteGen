import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { clipUsesEnd, KLING_MODELS, MOTION_MODEL, PUPPET_SECONDS, type KlingQuality } from "../src/methods";
import { motionPrompt } from "../src/motionPrompt";
import { characterPath } from "./cursorImage";
import { clearLive, setLive } from "./live";
import { prepareMotionVideo, spriteFromVideo } from "./spriteVideo";

const QUEUE = "https://queue.fal.run";
const TOKEN_URL = "https://rest.fal.ai/storage/auth/token?storage_type=fal-cdn-v3";
const UPLOAD_URL = "https://v3.fal.media/files/upload";

export function readFalKey(envPath: string) {
  const fromEnv = process.env.FAL_KEY?.trim() ?? "";
  if (!existsSync(envPath)) return fromEnv;
  const match = readFileSync(envPath, "utf8").match(/^FAL_KEY=(.*)$/m);
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") || fromEnv;
}

function mimeOf(file: string) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  throw new Error("PNG, JPEG, WebP, MP4, WebM만 올릴 수 있습니다.");
}

export async function falJson(url: string, key: string, scheme: string, body?: string) {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `${scheme} ${key}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body,
  });
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text.slice(0, 400) };
  }
  if (!response.ok) {
    const detail = payload.detail || payload.message || payload.error || response.statusText;
    throw new Error(`fal ${response.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  return payload;
}

export async function prepareStill(source: string, destination: string) {
  const rendered = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = rendered.info.width;
  const height = rendered.info.height;
  if (width < 1 || height < 1) throw new Error("기준 이미지 크기를 읽지 못했습니다.");
  const background = borderColor(rendered.data, width, height);
  const bounds = characterBounds(rendered.data, width, height, background);
  let image = sharp(rendered.data, {
    raw: { width, height, channels: 4 },
  }).extract({ left: bounds.minX, top: bounds.minY, width: bounds.width, height: bounds.height });
  let placedWidth = bounds.width;
  let placedHeight = bounds.height;
  const short = Math.min(placedWidth, placedHeight);
  if (short < 300) {
    const scale = 512 / short;
    placedWidth = Math.max(300, Math.round(bounds.width * scale));
    placedHeight = Math.max(300, Math.round(bounds.height * scale));
    image = image.resize(placedWidth, placedHeight, {
      kernel: short <= 128 ? "nearest" : "lanczos3",
      fit: "fill",
    });
  }
  const flat = await image.flatten({ background }).png().toBuffer();
  const pad = stillPadding(placedWidth, placedHeight);
  await sharp(flat).extend({ ...pad, background }).png().toFile(destination);
}

const MIN_STILL_ASPECT = 0.41;
const MAX_STILL_ASPECT = 2.49;

function borderColor(data: Buffer, width: number, height: number) {
  const counts = new Map<string, { r: number; g: number; b: number; n: number }>();
  const take = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    if (data[index + 3] < 16) return;
    const key = `${data[index]},${data[index + 1]},${data[index + 2]}`;
    const current = counts.get(key);
    if (current) current.n += 1;
    else counts.set(key, { r: data[index], g: data[index + 1], b: data[index + 2], n: 1 });
  };
  for (let x = 0; x < width; x++) {
    take(x, 0);
    if (height > 1) take(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    take(0, y);
    if (width > 1) take(width - 1, y);
  }
  let best: { r: number; g: number; b: number; n: number } | null = null;
  for (const color of counts.values()) {
    if (!best || color.n > best.n) best = color;
  }
  return { r: best?.r ?? 0, g: best?.g ?? 0, b: best?.b ?? 0, alpha: 1 };
}

function characterBounds(
  data: Buffer,
  width: number,
  height: number,
  background: { r: number; g: number; b: number },
) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const backdrop = (r: number, g: number, b: number, a: number) => {
    if (a < 16) return true;
    return Math.abs(r - background.r) <= 24 && Math.abs(g - background.g) <= 24 && Math.abs(b - background.b) <= 24;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      if (backdrop(data[index], data[index + 1], data[index + 2], data[index + 3])) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0 || (maxX - minX + 1) * (maxY - minY + 1) < width * height * 0.05) {
    return { minX: 0, minY: 0, width, height };
  }
  return { minX, minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function stillPadding(width: number, height: number) {
  let left = Math.max(8, Math.round(width * 0.25));
  let right = left;
  let bottom = Math.max(8, Math.round(height * 0.2));
  let top = bottom;
  let canvasW = width + left + right;
  let canvasH = height + top + bottom;
  if (canvasW / canvasH < MIN_STILL_ASPECT) {
    const extra = Math.max(0, Math.ceil(canvasH * MIN_STILL_ASPECT) - canvasW);
    const half = Math.floor(extra / 2);
    left += half;
    right += extra - half;
    canvasW += extra;
  } else if (canvasW / canvasH > MAX_STILL_ASPECT) {
    const extra = Math.max(0, Math.ceil(canvasW / MAX_STILL_ASPECT) - canvasH);
    const half = Math.floor(extra / 2);
    top += half;
    bottom += extra - half;
    canvasH += extra;
  }
  const room = Math.max(0, Math.floor(canvasW / MIN_STILL_ASPECT) - canvasH);
  const head = Math.min(Math.round(height / 2), room);
  top += head;
  return { top, right, bottom, left };
}

export async function uploadBuffer(key: string, body: Buffer, name: string, contentType: string) {
  const token = await falJson(TOKEN_URL, key, "Key", "{}");
  const tokenValue = token.token;
  const tokenType = token.token_type;
  if (typeof tokenValue !== "string" || typeof tokenType !== "string") {
    throw new Error("fal 업로드 토큰이 없습니다. 유료 요청은 보내지 않았습니다.");
  }
  const response = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `${tokenType} ${tokenValue}`,
      "Content-Type": contentType,
      "X-Fal-File-Name": name,
    },
    body: new Uint8Array(body),
  });
  const uploaded = await response.json() as { access_url?: string };
  if (!response.ok || !uploaded.access_url?.startsWith("https://")) {
    throw new Error("fal CDN 업로드에 실패했습니다. 유료 요청은 보내지 않았습니다.");
  }
  return uploaded.access_url;
}

export async function uploadImage(key: string, file: string) {
  return uploadBuffer(key, readFileSync(file), path.basename(file), mimeOf(file));
}

export async function runQueued(options: {
  apiKey: string;
  model: string;
  source: string;
  input: Record<string, unknown>;
  work: string;
  timeoutMs?: number;
}) {
  setLive("대기열에 넣는 중입니다");
  const submitted = await falJson(`${QUEUE}/${options.model}`, options.apiKey, "Key", JSON.stringify(options.input));
  const statusUrl = submitted.status_url;
  const responseUrl = submitted.response_url;
  const requestId = String(submitted.request_id ?? "");
  writeFileSync(path.join(options.work, "job.json"), `${JSON.stringify({
    model: options.model,
    source: options.source,
    requestId,
    statusUrl,
    responseUrl,
  }, null, 2)}\n`);
  if (typeof statusUrl !== "string" || typeof responseUrl !== "string") {
    throw new Error("fal 큐 주소가 없습니다. 대시보드의 request history를 확인하세요. 같은 요청을 다시 보내지 마세요.");
  }

  const deadline = Date.now() + (options.timeoutMs ?? 12 * 60 * 1000);
  let state = "IN_QUEUE";
  while (Date.now() < deadline) {
    const status = await falJson(statusUrl, options.apiKey, "Key");
    state = String(status.status ?? "");
    setLive(state === "IN_PROGRESS" ? "영상을 만들고 있습니다" : "대기열에서 기다리고 있습니다");
    if (state === "COMPLETED") {
      if (status.error || status.error_type) {
        throw new Error(`fal 생성 실패: ${String(status.error_type || status.error)}`);
      }
      break;
    }
    if (state !== "IN_QUEUE" && state !== "IN_PROGRESS") throw new Error(`알 수 없는 fal 상태: ${state}`);
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  if (state !== "COMPLETED") throw new Error("12분 안에 영상이 끝나지 않았습니다. 저장된 job.json의 요청을 다시 보내지 마세요.");

  setLive("만든 영상을 받고 있습니다");
  const result = await falJson(responseUrl, options.apiKey, "Key");
  const video = result.video as { url?: string } | undefined;
  if (!video?.url?.startsWith("https://")) throw new Error("결과 영상에 다운로드 주소가 없습니다.");
  const response = await fetch(video.url);
  if (!response.ok) throw new Error(`영상 다운로드 실패: ${response.status}`);
  const filePath = path.join(options.work, "generated.mp4");
  writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
  return { filePath, model: options.model, requestId };
}

function openWork(prefix = "") {
  const work = path.join(path.dirname(characterPath), `${prefix}${Date.now()}`);
  mkdirSync(work, { recursive: true });
  return work;
}

export async function generateFalClip(options: {
  apiKey: string;
  description: string;
  style: string;
  motion: string;
  action: string;
  quality: KlingQuality;
  loop?: boolean;
  label?: string;
  prompt?: string;
}) {
  if (!existsSync(characterPath)) throw new Error("기준 캐릭터 이미지를 먼저 올려 주세요.");
  const loop = options.loop ?? clipUsesEnd(options.motion);
  const work = openWork();
  const prompt = options.prompt?.trim() || motionPrompt(options.description, options.style, loop, options.action, options.label ?? "");
  writeFileSync(path.join(work, "prompt.txt"), `${prompt}\n`, "utf8");
  setLive("기준 그림을 올리고 있습니다");
  const stillPath = path.join(work, "still.png");
  await prepareStill(characterPath, stillPath);
  const imageUrl = await uploadImage(options.apiKey, stillPath);
  const generated = await runQueued({
    apiKey: options.apiKey,
    model: KLING_MODELS[options.quality],
    source: "kling",
    work,
    input: {
      prompt,
      start_image_url: imageUrl,
      duration: "3",
      generate_audio: false,
      ...(loop ? { end_image_url: imageUrl } : {}),
    },
  });
  return { ...generated, motion: options.motion, folder: path.basename(work) };
}

export async function generateMotion(options: {
  apiKey: string;
  description: string;
  style: string;
  motion: string;
  videoPath: string;
  source: "pose" | "puppet";
  label?: string;
  prompt?: string;
}) {
  if (!existsSync(characterPath)) throw new Error("기준 캐릭터 이미지를 먼저 올려 주세요.");
  if (!existsSync(options.videoPath)) throw new Error("따라갈 동작 영상이 없습니다.");
  const work = openWork();
  const prompt = options.prompt?.trim() || motionPrompt(options.description, options.style, false, "", options.label ?? "", true);
  writeFileSync(path.join(work, "prompt.txt"), `${prompt}\n`, "utf8");
  const stillPath = path.join(work, "still.png");
  await prepareStill(characterPath, stillPath);
  const videoFile = await prepareMotionVideo(options.videoPath, path.join(work, "motion.mp4"));
  setLive("기준 그림과 영상을 올리고 있습니다");
  const [imageUrl, videoUrl] = await Promise.all([
    uploadImage(options.apiKey, stillPath),
    uploadBuffer(options.apiKey, readFileSync(videoFile), "take.mp4", "video/mp4"),
  ]);
  const input: Record<string, unknown> = {
    prompt,
    image_url: imageUrl,
    video_url: videoUrl,
    character_orientation: "image",
    keep_original_sound: false,
  };
  const generated = await runQueued({
    apiKey: options.apiKey,
    model: MOTION_MODEL,
    source: options.source,
    work,
    input,
  });
  return { ...generated, motion: options.motion, folder: path.basename(work) };
}

export async function generatePuppet(options: {
  apiKey: string;
  motion: string;
  action: string;
  still: Buffer;
  label?: string;
}) {
  const work = openWork("puppet-");
  const prompt = [
    "A plain gray faceless mannequin, the same figure as the image, performs one motion.",
    `Motion: ${options.motion}.`,
    options.label && options.label !== options.motion ? `Name: ${options.label}.` : "",
    options.action ? `Action: ${options.action}.` : "",
    "Natural, weighty movement with clear anticipation and follow-through.",
    "Side view, facing right the whole time and never turning toward the camera.",
    "The whole body stays inside the frame from head to feet at every moment.",
    "Camera locked, no zoom, no pan, no cut.",
    "Plain light background. No scenery, no text, no effects, no projectiles, no extra people.",
  ].filter(Boolean).join("\n");
  writeFileSync(path.join(work, "prompt.txt"), `${prompt}\n`, "utf8");
  const stillPath = path.join(work, "still.png");
  writeFileSync(stillPath, options.still);
  setLive("회색 인형 그림을 올리고 있습니다");
  const imageUrl = await uploadImage(options.apiKey, stillPath);
  const generated = await runQueued({
    apiKey: options.apiKey,
    model: KLING_MODELS.standard,
    source: "puppet-video",
    work,
    input: {
      prompt,
      start_image_url: imageUrl,
      duration: String(PUPPET_SECONDS),
      generate_audio: false,
    },
  });
  return { ...generated, motion: options.motion, folder: path.basename(work) };
}

function openJobs() {
  const gen = path.resolve(process.cwd(), ".gen");
  if (!existsSync(gen)) return [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const found = [];
  for (const name of readdirSync(gen)) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) continue;
    const dir = path.join(gen, name);
    const jobPath = path.join(dir, "job.json");
    if (!existsSync(jobPath) || existsSync(path.join(dir, "generated.mp4"))) continue;
    if (statSync(dir).mtimeMs < cutoff) continue;
    try {
      const job = JSON.parse(readFileSync(jobPath, "utf8")) as { model?: string; requestId?: string; statusUrl?: string; responseUrl?: string; failed?: boolean };
      const requestId = job.requestId?.trim() ?? "";
      const model = job.model?.trim() ?? "";
      if (!requestId || !model) continue;
      const app = model.split("/").slice(0, 2).join("/");
      if (job.failed === true) continue;
      found.push({
        jobPath,
        video: path.join(dir, "generated.mp4"),
        statusUrl: job.statusUrl || `https://queue.fal.run/${app}/requests/${requestId}/status`,
        responseUrl: job.responseUrl || `https://queue.fal.run/${app}/requests/${requestId}`,
      });
    } catch {
      continue;
    }
  }
  return found;
}

export async function resumeOpenJobs(apiKey: string) {
  const jobs = openJobs();
  if (!apiKey || jobs.length === 0) {
    clearLive();
    return;
  }
  try {
    for (const job of jobs) {
      try {
        const deadline = Date.now() + 12 * 60 * 1000;
        let state = "";
        while (Date.now() < deadline) {
          const status = await falJson(job.statusUrl, apiKey, "Key");
          state = String(status.status ?? "");
          if (state === "COMPLETED") break;
          if (state !== "IN_QUEUE" && state !== "IN_PROGRESS") break;
          setLive(state === "IN_PROGRESS" ? "영상을 만들고 있습니다" : "대기열에서 기다리고 있습니다");
          await new Promise((resolve) => setTimeout(resolve, 4000));
        }
        if (state !== "COMPLETED") continue;
        const result = await falJson(job.responseUrl, apiKey, "Key");
        const video = result.video as { url?: string } | undefined;
        if (!video?.url?.startsWith("https://")) continue;
        const response = await fetch(video.url);
        if (!response.ok) continue;
        writeFileSync(job.video, Buffer.from(await response.arrayBuffer()));
        await spriteFromVideo(job.video, 8);
      } catch (error) {
        const message = error instanceof Error ? error.message : "끝난 영상을 받지 못했습니다.";
        const saved = JSON.parse(readFileSync(job.jobPath, "utf8")) as Record<string, unknown>;
        writeFileSync(job.jobPath, `${JSON.stringify({ ...saved, failed: true }, null, 2)}\n`);
        console.error(message);
      }
    }
  } finally {
    clearLive();
  }
}
