import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { characterPrompt } from "../src/characterPrompt";
import { jointLabel, stand, type BodyId } from "../src/pose";
import { drawWorkspace, pngFile } from "./characters";
import sharp from "sharp";

const root = path.resolve(process.cwd());

export function findAgent() {
  const candidates = [
    process.env.CURSOR_AGENT_BIN,
    path.join(process.env.LOCALAPPDATA ?? "", "cursor-agent", "agent.cmd"),
    path.join(process.env.LOCALAPPDATA ?? "", "cursor-agent", "agent.exe"),
    path.join(process.env.USERPROFILE ?? "", ".local", "bin", "agent.exe"),
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function redact(text: string) {
  return text.replace(/crsr_[A-Za-z0-9_-]+/g, "crsr_[redacted]");
}

function runAgent(agent: string, args: string[], apiKey: string, timeoutMs: number, cwd = root) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(agent, args, {
      cwd,
      env: { ...process.env, CURSOR_API_KEY: apiKey },
      windowsHide: true,
      shell: process.platform === "win32",
    });
    let text = "";
    const timer = setTimeout(() => {
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      } else {
        child.kill();
      }
      const tail = redact(text).trim().slice(-400);
      reject(new Error(`Cursor 에이전트가 제한 시간 안에 끝나지 못했습니다.${tail ? `\n${tail}` : ""}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      text += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      text += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(redact(text).slice(-1200) || `agent exited ${code}`));
      else resolve(redact(text));
    });
  });
}

export const characterPath = path.join(root, ".gen", "character.png");

export function cleanModel(value: string | undefined) {
  const model = value?.trim() ?? "";
  if (!model || model === "auto") return "";
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(model)) {
    throw new Error("모델 이름이 올바르지 않습니다.");
  }
  return model;
}

export async function listCursorModels(apiKey: string) {
  const agent = findAgent();
  if (!agent) throw new Error("Cursor agent CLI가 없습니다.");
  const output = await runAgent(agent, ["models"], apiKey, 30_000);
  const models = [{ id: "auto", label: "계정 기본" }];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9._-]{1,80}) - (.+)$/);
    if (!match || match[1] === "auto") continue;
    models.push({ id: match[1], label: match[2].trim() });
  }
  return models;
}

export async function drawCharacter(options: {
  apiKey: string;
  description: string;
  style: string;
  model?: string;
  prompt?: string;
}) {
  const agent = findAgent();
  if (!agent) {
    throw new Error("Cursor agent CLI가 없습니다. 설치 후 개발 서버를 다시 시작하세요.");
  }
  const work = drawWorkspace();
  try {
    const outPath = work.imagePath;
    const imagePrompt = options.prompt?.trim() || characterPrompt(options.description, options.style);
    const prompt = [
      "Generate exactly one image file and nothing else.",
      `Save it to this exact path: ${outPath}`,
      "Do not edit, create, or delete any other file.",
      imagePrompt,
    ].join("\n");
    writeFileSync(path.join(work.dir, "prompt.txt"), prompt, "utf8");

    const model = cleanModel(options.model);
    const args = [
      "-p",
      "Read prompt.txt and follow it exactly. Generate only the one image it names.",
      "--output-format",
      "text",
      "--trust",
      "--force",
      "--sandbox",
      "disabled",
      "--workspace",
      work.dir,
    ];
    if (model) args.push("--model", model);
    const output = await runAgent(agent, args, options.apiKey, 180_000, work.dir);

    const produced = newestImage(work.dir);
    if (!produced) throw new Error(`이미지 파일이 없습니다.\n${output.slice(-800)}`);
    return { filePath: produced };
  } catch (error) {
    rmSync(work.dir, { recursive: true, force: true });
    throw error;
  }
}

export async function drawPuppetFrame(options: {
  apiKey: string;
  action: string;
  index: number;
  count: number;
  feedback?: string;
  previous?: Buffer;
  next?: Buffer;
}) {
  const agent = findAgent();
  if (!agent) throw new Error("Cursor agent CLI가 없습니다. 설치 후 개발 서버를 다시 시작하세요.");
  const work = path.join(root, ".gen", `puppet-draw-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  const outPath = path.join(work, "image.png");
  const where = options.index <= 0
    ? "This is the first frame, the start of the motion."
    : options.index >= options.count - 1
      ? "This is the last frame, the end of the motion."
      : `This is frame ${options.index + 1} of ${options.count}, partway through the same motion.`;
  const references = [
    options.previous ? "previous.png is the frame just before this one. Keep that mannequin, camera, and body. Change the pose so this frame continues from it." : "",
    options.next ? "next.png is the frame just after this one. Keep that mannequin, camera, and body. Pose this frame so it leads into that picture." : "",
    options.previous || options.next ? "Read the reference images. Do not edit, move, or delete them, and do not copy a reference pose unchanged." : "",
  ].filter(Boolean);
  const prompt = [
    "Generate exactly one image file and nothing else.",
    `Save it to this exact path: ${outPath}`,
    "Do not edit, create, or delete any other file.",
    "Draw one plain gray faceless mannequin. No clothes, no hair, no face, no costume.",
    "The motion text describes only how it moves. Do not draw a game character, logo, or costume from it.",
    "Full body from head to feet. Side view, facing right. The whole body stays inside the frame.",
    "Plain light gray background. No scenery, no shadow, no text, no border.",
    where,
    `Motion: ${options.action}`,
    options.feedback ? `Redraw this frame with this correction: ${options.feedback}` : "",
    ...references,
  ].filter(Boolean).join("\n");
  try {
    if (options.previous) writeFileSync(path.join(work, "previous.png"), options.previous);
    if (options.next) writeFileSync(path.join(work, "next.png"), options.next);
    writeFileSync(path.join(work, "prompt.txt"), prompt, "utf8");
    const output = await runAgent(agent, [
      "-p",
      "Read prompt.txt and follow it exactly. Generate only the one image it names.",
      "--output-format",
      "text",
      "--trust",
      "--force",
      "--sandbox",
      "disabled",
      "--workspace",
      work,
    ], options.apiKey, 180_000, work);
    const produced = newestImage(work);
    if (!produced) throw new Error(`이미지 파일이 없습니다.\n${output.slice(-800)}`);
    const png = await pngFile(produced);
    return sharp(png).resize(768, 1024, {
      fit: "contain",
      background: { r: 238, g: 238, b: 238, alpha: 1 },
    }).png().toBuffer();
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function readJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const POSE_COORDS_MODEL = "claude-sonnet-5-5-medium";

export function readPoseJoints(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const joints: Record<string, { x: number; y: number }> = {};
  for (const id of Object.keys(jointLabel) as BodyId[]) {
    const point = source[id] as { x?: unknown; y?: unknown } | undefined;
    if (!point || typeof point.x !== "number" || typeof point.y !== "number" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    joints[id] = { x: Number(point.x.toFixed(3)), y: Number(point.y.toFixed(3)) };
  }
  return joints;
}

export async function generatePoseCoords(options: {
  apiKey: string;
  moment: string;
  feedback?: { text: string; joints: Record<string, { x: number; y: number }> };
}) {
  const agent = findAgent();
  if (!agent) throw new Error("Cursor agent CLI가 없습니다. 설치 후 개발 서버를 다시 시작하세요.");
  const work = path.join(root, ".gen", `coords-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  const outPath = path.join(work, "pose.json");
  const example = stand();
  const sample: Record<string, { x: number; y: number }> = {};
  for (const id of Object.keys(jointLabel) as BodyId[]) {
    sample[id] = { x: Number(example[id].x.toFixed(3)), y: Number(example[id].y.toFixed(3)) };
  }
  const task = options.feedback
    ? [
      "Current pose of this moment:",
      JSON.stringify(options.feedback.joints),
      `Pose: ${options.moment}`,
      `Feedback: ${options.feedback.text}`,
      "Start from the current pose and change it only as the feedback asks. Copy every joint the feedback does not need exactly as it is.",
      "When a limb turns, move the joints past it along with it, including the finger points of that hand.",
      "The current pose may have points slightly outside 0 to 1. That is allowed.",
    ]
    : [`Pose: ${options.moment}`];
  const prompt = [
    "Write exactly one file and nothing else. Do not draw or generate an image.",
    `Save it to this exact path: ${outPath}`,
    "Do not edit, create, or delete any other file.",
    "Work from this text alone. Do not open, search, or list any other file or folder. Do not run commands or scripts and do not calculate with code.",
    "Estimate the angles yourself and write the file right away. Bone lengths may be approximate; the app corrects every length and keeps your angles.",
    "The file is one JSON object that maps every joint name of the example to {\"x\": number, \"y\": number}. Use the same joint names, no others, and no comments.",
    "It is one person seen from the side, facing right. +x is forward.",
    "x and y run from 0 to 1 across a 768 wide by 1024 tall frame. y grows downward. The ground is y = 0.9.",
    "Names that start with r are the near arm and leg, toward the viewer. Names that start with l are the far arm and leg.",
    "rHand and lHand are a point just past the wrist on the back of the hand.",
    "Each finger has three points from the wrist outward: Thumb1, Thumb2, Thumb, and the same for Index, Middle, Ring, Pinky. The number 1 is the first knuckle, 2 is the second knuckle, and the name alone is the fingertip.",
    "A fist folds every finger knuckle back toward the palm. An open hand keeps the fingers straight.",
    "Keep bones close to the example lengths. Change angles only.",
    "When the person stands on the ground, the lowest foot touches y = 0.9. When the person is in the air, both feet are above that.",
    "Example standing body:",
    JSON.stringify(sample),
    ...task,
  ].join("\n");
  writeFileSync(path.join(work, "prompt.txt"), prompt, "utf8");
  let finished: Error | null = null;
  let output = "";
  const pending = runAgent(agent, [
    "-p",
    "Read prompt.txt and follow it exactly. Use no other tool except writing the one JSON file it names.",
    "--output-format",
    "text",
    "--trust",
    "--force",
    "--sandbox",
    "disabled",
    "--workspace",
    work,
    "--model",
    POSE_COORDS_MODEL,
  ], options.apiKey, 180_000, work).then((text) => {
    output = text;
  }, (error: Error) => {
    finished = error;
  });
  const readFile = () => (existsSync(outPath) ? readJsonObject(readFileSync(outPath, "utf8")) : null);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const joints = readFile();
    if (joints) return { joints };
    if (finished || output) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await pending;
  const joints = readFile() ?? readJsonObject(output);
  if (joints) return { joints };
  throw finished ?? new Error("AI가 관절 좌표를 저장하지 않았습니다.");
}

function newestImage(directory: string): string | null {
  const files: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      const info = statSync(full);
      if (info.isDirectory()) walk(full);
      else if (/\.(png|webp|jpe?g)$/i.test(entry) && !/^(?:previous|next)\./i.test(entry)) files.push(full);
    }
  };
  walk(directory);
  files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] ?? null;
}

export function readKeyFile(envPath: string) {
  if (!existsSync(envPath)) return process.env.CURSOR_API_KEY?.trim() ?? "";
  const text = readFileSync(envPath, "utf8");
  const match = text.match(/^CURSOR_API_KEY=(.*)$/m);
  return match?.[1]?.trim() || process.env.CURSOR_API_KEY?.trim() || "";
}
