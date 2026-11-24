import { fingerJointIds, GROUND_Y, POSE_H, sidePoint, VIEW, type BodyId, type JointId, type Point, type Pose } from "./pose";

const openposeLimbs: [JointId, JointId, string][] = [
  ["neck", "lShoulder", "#2f6bff"],
  ["lShoulder", "lElbow", "#3aa0ff"],
  ["lElbow", "lWrist", "#7fd0ff"],
  ["neck", "lHip", "#2451e6"],
  ["lHip", "lKnee", "#4d74ff"],
  ["lKnee", "lAnkle", "#8aa4ff"],
  ["neck", "rShoulder", "#ff3b30"],
  ["rShoulder", "rElbow", "#ff6a3d"],
  ["rElbow", "rWrist", "#ffb020"],
  ["neck", "rHip", "#ff5a6a"],
  ["rHip", "rKnee", "#ff7a59"],
  ["rKnee", "rAnkle", "#ff9a86"],
  ["neck", "nose", "#d7d7d7"],
  ["nose", "lEye", "#7aa2ff"],
  ["lEye", "lEar", "#4d74ff"],
  ["nose", "rEye", "#ff8a7a"],
  ["rEye", "rEar", "#ff5a6a"],
];

const faceJoints = new Set<JointId>(["rEye", "lEye", "rEar", "lEar"]);

const tipLimbs: [JointId, JointId, string][] = [
  ["lAnkle", "lToe", "#9eb6ff"],
  ["rAnkle", "rToe", "#ffb0a0"],
];

const nearFingers = ["#ff2d6a", "#ff5e3a", "#ff8a5b", "#ffb020", "#ffd1a8"];
const farFingers = ["#1d4ed8", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd"];

export function controlHandlePoint(pose: Pose, id: BodyId): Point {
  return sidePoint(pose, id);
}

function drawFinger(ctx: CanvasRenderingContext2D, pose: Pose, wrist: BodyId, joints: readonly BodyId[], color: string, w: number, h: number) {
  const scale = h / POSE_H;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  const points = [wrist, ...joints];
  for (let segment = 1; segment < points.length; segment += 1) {
    const from = sidePoint(pose, points[segment - 1]);
    const to = sidePoint(pose, points[segment]);
    ctx.lineWidth = (segment === 1 ? 7 : segment === 2 ? 5 : 3.5) * scale;
    ctx.beginPath();
    ctx.moveTo(from.x * w, from.y * h);
    ctx.lineTo(to.x * w, to.y * h);
    ctx.stroke();
  }
}

function drawFingers(ctx: CanvasRenderingContext2D, pose: Pose, wrist: BodyId, side: "r" | "l", colors: string[], w: number, h: number) {
  colors.forEach((color, index) => drawFinger(ctx, pose, wrist, fingerJointIds(side, index), color, w, h));
}

function stroke(ctx: CanvasRenderingContext2D, pose: Pose, a: JointId, b: JointId, color: string, width: number, w: number, h: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  const from = sidePoint(pose, a);
  const to = sidePoint(pose, b);
  ctx.moveTo(from.x * w, from.y * h);
  ctx.lineTo(to.x * w, to.y * h);
  ctx.stroke();
}

function limbSide(a: JointId, b: JointId): "l" | "r" | "c" {
  if (a.startsWith("l") || b.startsWith("l")) return "l";
  if (a.startsWith("r") || b.startsWith("r")) return "r";
  return "c";
}

function drawLimbs(
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  limbs: [JointId, JointId, string][],
  w: number,
  h: number,
  scale: number,
) {
  for (const [a, b, color] of limbs) {
    const thin = faceJoints.has(a) || faceJoints.has(b);
    stroke(ctx, pose, a, b, color, (thin ? 6 : 16) * scale, w, h);
  }
}

function drawProfileBody(ctx: CanvasRenderingContext2D, pose: Pose, w: number, h: number) {
  const scale = h / POSE_H;
  const neckPoint = sidePoint(pose, "neck");
  const nosePoint = sidePoint(pose, "nose");
  const rightHip = sidePoint(pose, "rHip");
  const leftHip = sidePoint(pose, "lHip");
  const neck = { x: neckPoint.x * w, y: neckPoint.y * h };
  const nose = { x: nosePoint.x * w, y: nosePoint.y * h };
  const hip = {
    x: ((rightHip.x + leftHip.x) / 2) * w,
    y: ((rightHip.y + leftHip.y) / 2) * h,
  };
  const fx = nose.x - neck.x;
  const fy = nose.y - neck.y;
  const face = Math.hypot(fx, fy) || 1;
  const hx = fx / face;
  const hy = fy / face;
  const px = -hy;
  const py = hx;
  const dir = nose.x >= neck.x ? 1 : -1;
  const headR = Math.max(54 * scale, face * 0.82);
  const head = { x: neck.x + dir * headR * 0.22, y: neck.y - headR * 0.82 };
  const front = headR * 1.35;
  const back = headR * 0.82;
  const drop = hip.y - neck.y;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = Math.max(1.5, 3 * scale);
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(neck.x - dir * back, neck.y - headR * 0.2);
  ctx.bezierCurveTo(
    neck.x - dir * back * 1.15, neck.y + drop * 0.32,
    hip.x - dir * back, hip.y - drop * 0.18,
    hip.x - dir * back * 0.82, hip.y,
  );
  ctx.quadraticCurveTo(hip.x, hip.y + headR * 0.22, hip.x + dir * front * 0.62, hip.y);
  ctx.bezierCurveTo(
    hip.x + dir * front, hip.y - drop * 0.22,
    neck.x + dir * front * 1.2, neck.y + drop * 0.58,
    neck.x + dir * front * 1.05, neck.y + drop * 0.28,
  );
  ctx.quadraticCurveTo(neck.x + dir * front * 0.45, neck.y + headR * 0.05, neck.x - dir * back, neck.y - headR * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(head.x, head.y, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(nose.x, nose.y);
  ctx.lineTo(head.x + px * headR * 0.34 + hx * headR * 0.78, head.y + py * headR * 0.34 + hy * headR * 0.78);
  ctx.lineTo(head.x - px * headR * 0.46 + hx * headR * 0.28, head.y - py * headR * 0.46 + hy * headR * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function drawWideOpenPose(
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  w: number,
  h: number,
  view: { left: number; top: number; width: number; height: number } = VIEW,
) {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);
  const ground = ((GROUND_Y - view.top) / view.height) * h;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = Math.max(1, 2 * (h / POSE_H));
  ctx.beginPath();
  ctx.moveTo(0, ground);
  ctx.lineTo(w, ground);
  ctx.stroke();
  ctx.save();
  ctx.translate((-view.left / view.width) * w, (-view.top / view.height) * h);
  ctx.scale(1 / view.width, 1 / view.height);
  const scale = h / POSE_H;
  ctx.globalAlpha = 0.95;
  const farLimbs = openposeLimbs.filter(([a, b]) => limbSide(a, b) === "l");
  const nearLimbs = openposeLimbs.filter(([a, b]) => limbSide(a, b) === "r");
  const axisLimbs = openposeLimbs.filter(([a, b]) => limbSide(a, b) === "c");
  drawLimbs(ctx, pose, farLimbs, w, h, scale);
  for (const [a, b, color] of tipLimbs) {
    if (a.startsWith("l")) stroke(ctx, pose, a, b, color, 10 * scale, w, h);
  }
  drawFingers(ctx, pose, "lWrist", "l", farFingers, w, h);
  drawProfileBody(ctx, pose, w, h);
  drawLimbs(ctx, pose, nearLimbs, w, h, scale);
  drawLimbs(ctx, pose, axisLimbs, w, h, scale);
  for (const [a, b, color] of tipLimbs) {
    if (a.startsWith("r")) stroke(ctx, pose, a, b, color, 10 * scale, w, h);
  }
  drawFingers(ctx, pose, "rWrist", "r", nearFingers, w, h);
  ctx.restore();
}

type BonePoint = { x: number; y: number; z: number };

const turnedChains: [JointId, JointId, string][] = [
  ["neck", "nose", "#d7d7d7"],
  ["neck", "lShoulder", "#2f6bff"],
  ["lShoulder", "lElbow", "#3aa0ff"],
  ["lElbow", "lWrist", "#7fd0ff"],
  ["neck", "lHip", "#2451e6"],
  ["lHip", "lKnee", "#4d74ff"],
  ["lKnee", "lAnkle", "#8aa4ff"],
  ["neck", "rShoulder", "#ff3b30"],
  ["rShoulder", "rElbow", "#ff6a3d"],
  ["rElbow", "rWrist", "#ffb020"],
  ["neck", "rHip", "#ff5a6a"],
  ["rHip", "rKnee", "#ff7a59"],
  ["rKnee", "rAnkle", "#ff9a86"],
];

function placedBone(point: Point): BonePoint {
  return { x: point.x - 0.5, y: 0.9 - point.y, z: point.z ?? 0 };
}

function rotateBone(point: BonePoint, angle: number): BonePoint {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos + point.z * sin,
    y: point.y,
    z: -point.x * sin + point.z * cos,
  };
}

export function drawTurnedBones(ctx: CanvasRenderingContext2D, pose: Pose, facing: number, w: number, h: number) {
  const turn = facing * Math.PI / 180;
  const yaw = Math.PI / 2 + turn;
  const placed = new Map<JointId, BonePoint>();
  const at = (id: JointId) => {
    const cached = placed.get(id);
    if (cached) return cached;
    const point = rotateBone(placedBone(pose[id]), yaw);
    placed.set(id, point);
    return point;
  };
  const chain = (from: JointId, to: JointId) => {
    const start = placedBone(pose[from]);
    const end = placedBone(pose[to]);
    const step = rotateBone({ x: end.x - start.x, y: end.y - start.y, z: end.z - start.z }, turn);
    const origin = at(from);
    placed.set(to, { x: origin.x + step.x, y: origin.y + step.y, z: origin.z + step.z });
  };
  at("neck");
  at("rShoulder");
  at("lShoulder");
  at("rHip");
  at("lHip");
  chain("neck", "nose");
  chain("rShoulder", "rElbow");
  chain("rElbow", "rWrist");
  chain("lShoulder", "lElbow");
  chain("lElbow", "lWrist");
  chain("rHip", "rKnee");
  chain("rKnee", "rAnkle");
  chain("lHip", "lKnee");
  chain("lKnee", "lAnkle");

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of placed.values()) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const span = Math.max(maxX - minX, maxY - minY, 0.35);
  const pad = Math.max(6, Math.round(Math.min(w, h) * 0.08));
  const scale = Math.min((w - pad * 2) / span, (h - pad * 2) / span);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const map = (point: BonePoint) => ({
    x: w / 2 + (point.x - centerX) * scale,
    y: h / 2 - (point.y - centerY) * scale,
  });
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = "round";
  const bones = [...turnedChains].sort((a, b) => {
    const az = (at(a[0]).z + at(a[1]).z) / 2;
    const bz = (at(b[0]).z + at(b[1]).z) / 2;
    return az - bz;
  });
  for (const [from, to, color] of bones) {
    const start = map(at(from));
    const end = map(at(to));
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(3, h / 32);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
}

export function drawSideKey(ctx: CanvasRenderingContext2D, h: number) {
  const scale = h / POSE_H;
  const font = Math.max(12, Math.round(18 * scale));
  ctx.font = `600 ${font}px "Pretendard Variable", "Inter Tight", sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("옆모습 · 코 쪽이 앞", 16 * scale, 22 * scale);
  const rows: [string, string][] = [
    ["#ff4d3a", "가까운 쪽"],
    ["#3d8bff", "먼 쪽"],
  ];
  rows.forEach(([color, label], index) => {
    const y = (52 + index * 28) * scale;
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(20 * scale, y, 6 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, 34 * scale, y);
  });
}
