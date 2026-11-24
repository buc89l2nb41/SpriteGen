import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { methodById, motionLabel, MOTION_FPS, MOTION_MAKE_FRAMES, MOTION_MIN_SECONDS, MOTION_MAX_SECONDS } from "../src/methods";
import { characterPath, cleanModel, drawCharacter, drawPuppetFrame, findAgent, generatePoseCoords, listCursorModels, readKeyFile, readPoseJoints } from "./cursorImage";
import { generateFalClip, generateMotion, generatePuppet, readFalKey, resumeOpenJobs } from "./falVideo";
import type { PipelineResult } from "./pipeline";
import { pngFile, saveCharacter } from "./characters";
import { listHistory, resolveGenFile } from "./history";
import { clearLive, readLive, setLive } from "./live";
import {
  buildMatteOptions,
  chooseMatte,
  clipDuration,
  clipPath,
  motionSource,
  performanceMeta,
  puppetCandidates,
  spriteFromVideo,
  storePerformance,
  takePath,
  usePuppet,
  workingClip,
  workingSeconds,
  writeClip,
  writePuppetSequence,
} from "./spriteVideo";

const envPath = path.resolve(process.cwd(), ".env");
let modelCache: { key: string; at: number; models: { id: string; label: string }[] } | null = null;

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function png(buffer: Buffer) {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function decodePng(value: string, max = 2_000_000) {
  const match = value.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("칸 그림이 PNG가 아닙니다.");
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length > max) throw new Error("칸 그림이 너무 큽니다.");
  return bytes;
}

function genFileUrl(folder: string, name: string) {
  return `/api/file?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(name)}`;
}

export function apiPlugin(): Plugin {
  return {
    name: "spritegen-api",
    configureServer(server) {
      void resumeOpenJobs(readFalKey(envPath)).catch((error) => {
        console.error(error instanceof Error ? error.message : "끝난 영상을 받지 못했습니다.");
      });
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        try {
          const url = new URL(req.url, "http://localhost");
          if (req.method === "GET" && url.pathname === "/api/live") {
            send(res, 200, { live: readLive() });
            return;
          }
          if (req.method === "GET" && url.pathname === "/api/history") {
            send(res, 200, { items: listHistory() });
            return;
          }
          if (req.method === "GET" && url.pathname === "/api/file") {
            const file = resolveGenFile(url.searchParams.get("folder") ?? "", url.searchParams.get("name") ?? "");
            if (!file) {
              send(res, 404, { error: "저장된 파일을 찾지 못했습니다." });
              return;
            }
            res.statusCode = 200;
            const lower = file.toLowerCase();
            const contentType = lower.endsWith(".mp4")
              ? "video/mp4"
              : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
                ? "image/jpeg"
                : lower.endsWith(".webp")
                  ? "image/webp"
                  : "image/png";
            res.setHeader("content-type", contentType);
            res.end(readFileSync(file));
            return;
          }
          if (req.method === "GET" && url.pathname === "/api/status") {
            const take = performanceMeta();
            send(res, 200, {
              key: Boolean(readKeyFile(envPath)),
              agent: Boolean(findAgent()),
              character: existsSync(characterPath),
              fal: Boolean(readFalKey(envPath)),
              take: take.ready,
              takeSeconds: take.seconds,
              takeTrimmed: take.trimmed,
              takeExtendedFrom: take.extendedFrom,
              bodySeconds: workingSeconds("performance"),
              puppetSeconds: workingSeconds("puppet"),
              ...savedDraft(),
            });
            return;
          }
          if (req.method === "GET" && url.pathname === "/api/character") {
            if (!existsSync(characterPath)) {
              send(res, 200, { character: null });
              return;
            }
            send(res, 200, { character: png(readFileSync(characterPath)) });
            return;
          }
          if (req.method === "POST" && url.pathname === "/api/character") {
            const payload = JSON.parse((await readJson(req)) || "{}") as { image?: string };
            const image = payload.image ?? "";
            const match = image.match(/^data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
            if (!match) {
              send(res, 400, { error: "PNG, JPEG, WebP 이미지를 올려 주세요." });
              return;
            }
            const bytes = Buffer.from(match[1], "base64");
            if (bytes.length > 6_000_000) {
              send(res, 400, { error: "이미지가 6MB를 넘습니다." });
              return;
            }
            await saveCharacter(bytes);
            send(res, 200, { saved: true, character: png(readFileSync(characterPath)) });
            return;
          }
          if (req.method === "POST" && url.pathname === "/api/character-draw") {
            const payload = JSON.parse((await readJson(req)) || "{}") as { description?: string; style?: string; model?: string; prompt?: string };
            const description = payload.description?.trim() ?? "";
            const prompt = payload.prompt?.replace(/\r\n/g, "\n").trim() ?? "";
            if (!description || description.length > 300) {
              send(res, 400, { error: "그릴 캐릭터를 300자 안으로 적어 주세요." });
              return;
            }
            if (prompt.length > 4000) {
              send(res, 400, { error: "보낼 문장은 4000자 안으로 적어 주세요." });
              return;
            }
            const key = readKeyFile(envPath);
            if (!key) {
              send(res, 400, { error: "Cursor API 키가 없습니다. SpriteGen/.env에 넣어 주세요." });
              return;
            }
            setLive("캐릭터를 그리고 있습니다", "캐릭터 그리기");
            const drawn = await drawCharacter({
              apiKey: key,
              description,
              style: payload.style?.trim() || "pixel art",
              model: cleanModel(payload.model),
              prompt,
            });
            clearLive();
            send(res, 200, { ok: true, image: png(await pngFile(drawn.filePath)) });
            return;
          }
          if (req.method === "GET" && url.pathname === "/api/models") {
            const key = readKeyFile(envPath);
            if (!key) {
              send(res, 200, { models: [{ id: "auto", label: "계정 기본" }] });
              return;
            }
            if (!modelCache || modelCache.key !== key || Date.now() - modelCache.at > 5 * 60_000) {
              modelCache = { key, at: Date.now(), models: await listCursorModels(key) };
            }
            send(res, 200, { models: modelCache.models });
            return;
          }
          if (req.method === "GET" && url.pathname === "/api/media") {
            const id = url.searchParams.get("id");
            const motion = url.searchParams.get("motion") ?? "";
            const requested = id === "performance" || id === "puppet" ? clipPath(id, motion) : id === "take" ? takePath : "";
            const file = requested && existsSync(requested) ? requested : id === "performance" || id === "puppet" ? workingClip(id) : "";
            if (!file || !existsSync(file)) {
              send(res, 404, { error: "아직 저장된 영상이 없습니다." });
              return;
            }
            res.statusCode = 200;
            res.setHeader("content-type", "video/mp4");
            res.setHeader("cache-control", "no-store");
            res.end(readFileSync(file));
            return;
          }
          if (req.method === "POST" && url.pathname === "/api/local-clip") {
            const payload = JSON.parse((await readJson(req)) || "{}") as { motion?: string; frames?: string[] };
            const motion = payload.motion?.trim() ?? "";
            const destination = clipPath("performance", motion);
            if (!destination) {
              send(res, 400, { error: "동작 이름이 올바르지 않습니다." });
              return;
            }
            if (!payload.frames || payload.frames.length !== MOTION_MAKE_FRAMES) {
              send(res, 400, { error: `몸 영상은 ${MOTION_MAKE_FRAMES}장, ${MOTION_MAKE_FRAMES / MOTION_FPS}초여야 합니다.` });
              return;
            }
            await writeClip(payload.frames.map(decodePng), destination, MOTION_FPS);
            const seconds = await clipDuration(destination);
            if (seconds < MOTION_MIN_SECONDS || seconds > MOTION_MAX_SECONDS) {
              unlinkSync(destination);
              send(res, 400, { error: `만든 영상이 ${seconds.toFixed(1)}초입니다. Kling은 ${MOTION_MIN_SECONDS}초 이상 ${MOTION_MAX_SECONDS}초 이하를 요구합니다.` });
              return;
            }
            writeFileSync(destination.replace(/\.mp4$/, ".json"), JSON.stringify({ seconds, body: true }));
            send(res, 200, { ok: true, motion, url: `/api/media?id=performance&motion=${motion}` });
            return;
          }
          if (req.method === "POST" && url.pathname === "/api/performance") {
            const payload = JSON.parse((await readJson(req)) || "{}") as { video?: string };
            const match = payload.video?.match(/^data:video\/(?:mp4|webm);base64,([A-Za-z0-9+/=]+)$/);
            if (!match) {
              send(res, 400, { error: "MP4 또는 WebM 영상을 올려 주세요." });
              return;
            }
            const bytes = Buffer.from(match[1], "base64");
            if (bytes.length > 18_000_000) {
              send(res, 400, { error: "영상이 18MB를 넘습니다. 더 짧은 영상으로 올려 주세요." });
              return;
            }
            const stored = await storePerformance(bytes);
            send(res, 200, { ok: true, ...stored, url: "/api/media?id=take" });
            return;
          }
          if (req.method === "GET" && url.pathname === "/api/puppet") {
            const motion = url.searchParams.get("motion") ?? "";
            if (!clipPath("puppet", motion)) {
              send(res, 400, { error: "동작 이름이 올바르지 않습니다." });
              return;
            }
            send(res, 200, {
              candidates: puppetCandidates(motion).map((folder) => ({ folder, video: genFileUrl(folder, "generated.mp4") })),
            });
            return;
          }
          if (req.method === "POST" && url.pathname === "/api/puppet-frame") {
            const payload = JSON.parse((await readJson(req)) || "{}") as {
              action?: string;
              index?: number;
              count?: number;
              feedback?: string;
              previous?: string;
              next?: string;
            };
            const action = payload.action?.trim() ?? "";
            const count = clampFrames(payload.count);
            const index = Math.round(Number(payload.index));
            const feedback = payload.feedback?.trim() ?? "";
            if (!action || action.length > 80) {
              send(res, 400, { error: "동작 설명은 80자 안으로 적어 주세요." });
              return;
            }
            if (!Number.isFinite(index) || index < 0 || index >= count) {
              send(res, 400, { error: "다시 그릴 장을 고르지 못했습니다." });
              return;
            }
            if (feedback.length > 200) {
              send(res, 400, { error: "피드백은 200자 안으로 적어 주세요." });
              return;
            }
            const previous = payload.previous ? decodePng(payload.previous, 4_000_000) : undefined;
            const next = payload.next ? decodePng(payload.next, 4_000_000) : undefined;
            const key = readKeyFile(envPath);
            if (!key) {
              send(res, 400, { error: "Cursor API 키가 없습니다. SpriteGen/.env에 넣어 주세요." });
              return;
            }
            const image = await drawPuppetFrame({ apiKey: key, action, index, count, feedback, previous, next });
            send(res, 200, { ok: true, image: png(image) });
            return;
          }
          if (req.method === "POST" && url.pathname === "/api/puppet-clip") {
            const payload = JSON.parse((await readJson(req)) || "{}") as { motion?: string; frames?: string[] };
            const motion = payload.motion?.trim() ?? "";
            if (!clipPath("puppet", motion)) {
              send(res, 400, { error: "동작 이름이 올바르지 않습니다." });
              return;
            }
            const frames = payload.frames ?? [];
            if (frames.length < 2 || frames.length > 8) {
              send(res, 400, { error: "회색 인형은 2장에서 8장까지입니다." });
              return;
            }
            const saved = await writePuppetSequence(motion, frames.map((frame) => decodePng(frame, 4_000_000)));
            send(res, 200, { ok: true, motion, seconds: saved.seconds, url: `/api/media?id=puppet&motion=${motion}` });
            return;
          }
          if (req.method === "POST" && url.pathname === "/api/puppet") {
            const payload = JSON.parse((await readJson(req)) || "{}") as { motion?: string; action?: string; still?: string; name?: string };
            const motion = payload.motion?.trim() ?? "";
            const action = payload.action?.trim() ?? "";
            const label = payload.name?.replace(/\s+/g, " ").trim() ?? "";
            if (!clipPath("puppet", motion)) {
              send(res, 400, { error: "동작 이름이 올바르지 않습니다." });
              return;
            }
            if (action.length > 80) {
              send(res, 400, { error: "동작 설명은 80자 안으로 적어 주세요." });
              return;
            }
            if (label.length > 40) {
              send(res, 400, { error: "동작 이름은 40자 안으로 적어 주세요." });
              return;
            }
            const still = decodePng(payload.still ?? "");
            const falKey = readFalKey(envPath);
            if (!falKey) {
              send(res, 400, { error: "FAL_KEY가 없습니다. SpriteGen/.env에 넣어 주세요." });
              return;
            }
            setLive("요청을 확인했습니다", `인형 영상 · ${label || motionLabel(motion)}`);
            const generated = await generatePuppet({ apiKey: falKey, motion, action, still, label });
            clearLive();
            send(res, 200, { ok: true, folder: generated.folder, video: genFileUrl(generated.folder, "generated.mp4") });
            return;
          }
          if (req.method === "POST" && url.pathname === "/api/puppet-use") {
            const payload = JSON.parse((await readJson(req)) || "{}") as { folder?: string; motion?: string };
            const used = await usePuppet(payload.folder?.trim() ?? "", payload.motion?.trim() ?? "");
            send(res, 200, { ok: true, ...used });
            return;
          }
          if (req.method === "POST" && url.pathname === "/api/generate-method") {
            const payload = JSON.parse((await readJson(req)) || "{}") as {
              method?: string;
              description?: string;
              style?: string;
              motion?: string;
              action?: string;
              quality?: string;
              name?: string;
              loop?: boolean;
              video?: string;
              prompt?: string;
            };
            const method = methodById(payload.method ?? "");
            const motion = payload.motion?.trim() || "";
            const action = payload.action?.trim() ?? "";
            const label = payload.name?.replace(/\s+/g, " ").trim() ?? "";
            if (!method) {
              send(res, 400, { error: "생성 방식을 고르세요." });
              return;
            }
            if (!/^[A-Za-z0-9_-]+$/.test(motion)) {
              send(res, 400, { error: "동작 이름이 올바르지 않습니다." });
              return;
            }
            if (action.length > 80) {
              send(res, 400, { error: "동작 설명은 80자 안으로 적어 주세요." });
              return;
            }
            if (label.length > 40) {
              send(res, 400, { error: "동작 이름은 40자 안으로 적어 주세요." });
              return;
            }
            const prompt = payload.prompt?.replace(/\r\n/g, "\n").trim() ?? "";
            if (prompt.length > 4000) {
              send(res, 400, { error: "보낼 문장은 4000자 안으로 적어 주세요." });
              return;
            }
            const falKey = readFalKey(envPath);
            if (!falKey) {
              send(res, 400, { error: "FAL_KEY가 없습니다. SpriteGen/.env에 넣어 주세요." });
              return;
            }
            if (!existsSync(characterPath)) {
              send(res, 400, { error: "기준 캐릭터 이미지를 먼저 올려 주세요." });
              return;
            }
            const motionVideo = method.id === "pose" || method.id === "puppet"
              ? motionSource(method.id, payload.video === "take" ? "take" : "puppet")
              : "";
            if (method.id !== "kling" && !motionVideo) {
              send(res, 400, {
                error: method.id === "pose"
                  ? "이 동작의 3D 몸 영상이 없습니다. 오른쪽에서 만드세요."
                  : `이 동작에 고른 인형 영상이 없습니다. 인형 영상을 만들어 고르거나, ${MOTION_MIN_SECONDS}초 이상 ${MOTION_MAX_SECONDS}초 이하인 영상을 올리세요.`,
              });
              return;
            }
            const common = {
              apiKey: falKey,
              description: payload.description?.trim() || "",
              style: payload.style?.trim() || "pixel art",
              motion,
            };
            setLive("요청을 확인했습니다", `${method.title} · ${label || motionLabel(motion)}`);
            const generated = method.id === "kling"
              ? await generateFalClip({ ...common, action, quality: payload.quality === "pro" ? "pro" : "standard", loop: payload.loop === true, label, prompt })
              : await generateMotion({ ...common, videoPath: motionVideo, source: method.id, label, prompt });
            setLive("칸을 나누고 영상 위치 그대로 자르고 있습니다");
            let made;
            try {
              made = await spriteFromVideo(generated.filePath, 8);
            } catch (error) {
              const reason = error instanceof Error ? error.message : "칸 맞추기에 실패했습니다.";
              throw new Error(`영상은 ${generated.folder}에 저장됐습니다. 추가 생성 없이 있는 영상으로 스프라이트를 누르세요. ${reason}`);
            }
            clearLive();
            const video = readFileSync(generated.filePath).toString("base64");
            send(res, 200, {
              ...present(method.id, made.raw, made.finished, made.folder),
              motion: made.motion,
              folder: made.folder,
              model: generated.model,
              video: `data:video/mp4;base64,${video}`,
            });
            return;
          }
          if (req.method === "POST" && url.pathname === "/api/clear-backdrop") {
            const payload = JSON.parse((await readJson(req)) || "{}") as { folder?: string; choice?: string };
            const folder = payload.folder?.trim() ?? "";
            if (payload.choice) {
              const chosen = await chooseMatte(folder, payload.choice);
              send(res, 200, { ok: true, ...chosen });
              return;
            }
            const offer = await buildMatteOptions(folder);
            send(res, 200, { ok: true, ...offer });
            return;
          }
          if (req.method === "POST" && url.pathname === "/api/pose-coords") {
            const payload = JSON.parse((await readJson(req)) || "{}") as { moment?: string; feedback?: string; joints?: unknown };
            const moment = payload.moment?.trim() ?? "";
            if (!moment || moment.length > 80) {
              send(res, 400, { error: "자세 설명을 80자 안으로 적어 주세요." });
              return;
            }
            const feedbackText = payload.feedback?.trim() ?? "";
            if (feedbackText.length > 200) {
              send(res, 400, { error: "피드백은 200자 안으로 적어 주세요." });
              return;
            }
            const current = feedbackText ? readPoseJoints(payload.joints) : null;
            if (feedbackText && !current) {
              send(res, 400, { error: "고칠 자세의 관절 좌표가 없습니다." });
              return;
            }
            const apiKey = readKeyFile(envPath);
            if (!apiKey) {
              send(res, 400, { error: "Cursor API 키가 없습니다." });
              return;
            }
            const generated = await generatePoseCoords({
              apiKey,
              moment,
              feedback: current ? { text: feedbackText, joints: current } : undefined,
            });
            send(res, 200, { ok: true, joints: generated.joints });
            return;
          }
          send(res, 404, { error: "not found" });
        } catch (error) {
          clearLive();
          send(res, 500, { error: error instanceof Error ? error.message : "생성에 실패했습니다." });
        }
      });
    },
  };
}

function savedDraft() {
  const file = path.resolve(process.cwd(), ".gen", "sets.json");
  const empty = { savedAction: "", savedLoop: false };
  if (!existsSync(file)) return empty;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { action?: string; loop?: boolean; at?: number }[];
    if (!Array.isArray(parsed) || !parsed.length) return empty;
    const latest = [...parsed].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0];
    const action = typeof latest?.action === "string" ? latest.action.replace(/\s+/g, " ").trim() : "";
    return { savedAction: action.slice(0, 80), savedLoop: latest?.loop === true };
  } catch {
    return empty;
  }
}

function clampFrames(value: number | undefined) {
  const frames = Number(value ?? 6);
  if (!Number.isFinite(frames)) return 6;
  return Math.max(2, Math.min(8, Math.round(frames)));
}

function present(
  source: string,
  raw: Buffer,
  result: PipelineResult,
  log: string,
) {
  return {
    ok: true,
    source,
    raw: png(raw),
    frames: result.frames.map(png),
    sheet: png(result.sheet),
    cellWidth: result.cellWidth,
    cellHeight: result.cellHeight,
    sourceWidth: result.sourceWidth ?? 0,
    sourceHeight: result.sourceHeight ?? 0,
    score: result.score,
    notes: result.notes,
    log,
  };
}
