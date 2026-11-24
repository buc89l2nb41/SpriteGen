export const POSE_W = 768;
export const POSE_H = 1024;
export const GROUND_Y = 0.9;

const fingerBases = ["Thumb", "Index", "Middle", "Ring", "Pinky"] as const;
export type FingerBase = (typeof fingerBases)[number];
export type FingerId = `${"r" | "l"}${FingerBase}`;
export type KnuckleId = `${"r" | "l"}${FingerBase}${1 | 2}`;
export type FingerJointId = FingerId | KnuckleId;

export type JointId =
  | "nose" | "neck"
  | "rShoulder" | "rElbow" | "rWrist" | "rHand"
  | "lShoulder" | "lElbow" | "lWrist" | "lHand"
  | "rHip" | "rKnee" | "rAnkle" | "rToe"
  | "lHip" | "lKnee" | "lAnkle" | "lToe"
  | FingerJointId
  | "rEye" | "lEye" | "rEar" | "lEar";

export type BodyId = Exclude<JointId, "rEye" | "lEye" | "rEar" | "lEar">;

export type Point = { x: number; y: number; z?: number };
export type Pose = Record<JointId, Point>;

export type Frame = {
  pose: Pose;
  key: boolean;
  facing?: number;
  image?: string;
};

export const rightFingers: FingerId[] = ["rThumb", "rIndex", "rMiddle", "rRing", "rPinky"];
export const leftFingers: FingerId[] = ["lThumb", "lIndex", "lMiddle", "lRing", "lPinky"];

export function fingerJointIds(side: "r" | "l", index: number): [KnuckleId, KnuckleId, FingerId] {
  const base = fingerBases[index];
  return [`${side}${base}1`, `${side}${base}2`, `${side}${base}`];
}

export const rightFingerJoints: FingerJointId[] = fingerBases.flatMap((_, index) => fingerJointIds("r", index));
export const leftFingerJoints: FingerJointId[] = fingerBases.flatMap((_, index) => fingerJointIds("l", index));
const fingerList: FingerJointId[] = [...rightFingerJoints, ...leftFingerJoints];
const fingerJointSet = new Set<string>(fingerList);

export function isFingerJoint(id: BodyId): id is FingerJointId {
  return fingerJointSet.has(id);
}

export const handles: BodyId[] = [
  "lAnkle", "lToe", "lKnee", "lHip", "lWrist", "lHand", "lElbow", "lShoulder",
  ...leftFingerJoints,
  "rAnkle", "rToe", "rKnee", "rHip", "rWrist", "rHand", "rElbow", "rShoulder",
  ...rightFingerJoints,
  "neck", "nose",
];

export const actorHandles: BodyId[] = handles.filter((id) => id !== "rHand" && id !== "lHand");

export const jointLabel: Record<BodyId, string> = {
  nose: "머리",
  neck: "목",
  rShoulder: "오른어깨",
  rElbow: "오른팔꿈치",
  rWrist: "오른손목",
  rHand: "오른손끝",
  rThumb1: "오른엄지 1마디",
  rThumb2: "오른엄지 2마디",
  rThumb: "오른엄지 끝",
  rIndex1: "오른검지 1마디",
  rIndex2: "오른검지 2마디",
  rIndex: "오른검지 끝",
  rMiddle1: "오른중지 1마디",
  rMiddle2: "오른중지 2마디",
  rMiddle: "오른중지 끝",
  rRing1: "오른약지 1마디",
  rRing2: "오른약지 2마디",
  rRing: "오른약지 끝",
  rPinky1: "오른소지 1마디",
  rPinky2: "오른소지 2마디",
  rPinky: "오른소지 끝",
  lShoulder: "왼어깨",
  lElbow: "왼팔꿈치",
  lWrist: "왼손목",
  lHand: "왼손끝",
  lThumb1: "왼엄지 1마디",
  lThumb2: "왼엄지 2마디",
  lThumb: "왼엄지 끝",
  lIndex1: "왼검지 1마디",
  lIndex2: "왼검지 2마디",
  lIndex: "왼검지 끝",
  lMiddle1: "왼중지 1마디",
  lMiddle2: "왼중지 2마디",
  lMiddle: "왼중지 끝",
  lRing1: "왼약지 1마디",
  lRing2: "왼약지 2마디",
  lRing: "왼약지 끝",
  lPinky1: "왼소지 1마디",
  lPinky2: "왼소지 2마디",
  lPinky: "왼소지 끝",
  rHip: "오른골반",
  rKnee: "오른무릎",
  rAnkle: "오른발목",
  rToe: "오른발끝",
  lHip: "왼골반",
  lKnee: "왼무릎",
  lAnkle: "왼발목",
  lToe: "왼발끝",
};

const bodyJointColor: Partial<Record<BodyId, number>> = {
  nose: 0xff0000,
  neck: 0xff5500,
  rShoulder: 0xffaa00,
  rElbow: 0xffff00,
  rWrist: 0xaaff00,
  rHand: 0xaaff00,
  lShoulder: 0x55ff00,
  lElbow: 0x00ff00,
  lWrist: 0x00ff55,
  lHand: 0x00ff55,
  rHip: 0x00ffaa,
  rKnee: 0x00ffff,
  rAnkle: 0x00aaff,
  rToe: 0x0088dd,
  lHip: 0x0055ff,
  lKnee: 0x0000ff,
  lAnkle: 0x5500ff,
  lToe: 0x3300cc,
};

const fingerJointColor: Record<FingerBase, [number, number, number]> = {
  Thumb: [0xff4d00, 0xff9900, 0xffe600],
  Index: [0x80ff00, 0x33ff00, 0x00ff1a],
  Middle: [0x00ffb3, 0x00ffff, 0x00b3ff],
  Ring: [0x001aff, 0x3300ff, 0x8000ff],
  Pinky: [0xff00e6, 0xff0099, 0xff004d],
};

export function jointColor(id: BodyId): number {
  const named = bodyJointColor[id];
  if (named !== undefined) return named;
  const match = /^(?:r|l)(Thumb|Index|Middle|Ring|Pinky)([12])?$/.exec(id);
  if (!match) return 0xf4f4f4;
  const [knuckle, middle, tip] = fingerJointColor[match[1] as FingerBase];
  if (match[2] === "1") return knuckle;
  if (match[2] === "2") return middle;
  return tip;
}

const bodyIds = Object.keys(jointLabel) as BodyId[];

const bones: [BodyId, BodyId][] = [
  ["nose", "neck"],
  ["rShoulder", "neck"],
  ["lShoulder", "neck"],
  ["rElbow", "rShoulder"],
  ["rWrist", "rElbow"],
  ["rHand", "rWrist"],
  ["rThumb1", "rWrist"],
  ["rThumb2", "rThumb1"],
  ["rThumb", "rThumb2"],
  ["rIndex1", "rWrist"],
  ["rIndex2", "rIndex1"],
  ["rIndex", "rIndex2"],
  ["rMiddle1", "rWrist"],
  ["rMiddle2", "rMiddle1"],
  ["rMiddle", "rMiddle2"],
  ["rRing1", "rWrist"],
  ["rRing2", "rRing1"],
  ["rRing", "rRing2"],
  ["rPinky1", "rWrist"],
  ["rPinky2", "rPinky1"],
  ["rPinky", "rPinky2"],
  ["lElbow", "lShoulder"],
  ["lWrist", "lElbow"],
  ["lHand", "lWrist"],
  ["lThumb1", "lWrist"],
  ["lThumb2", "lThumb1"],
  ["lThumb", "lThumb2"],
  ["lIndex1", "lWrist"],
  ["lIndex2", "lIndex1"],
  ["lIndex", "lIndex2"],
  ["lMiddle1", "lWrist"],
  ["lMiddle2", "lMiddle1"],
  ["lMiddle", "lMiddle2"],
  ["lRing1", "lWrist"],
  ["lRing2", "lRing1"],
  ["lRing", "lRing2"],
  ["lPinky1", "lWrist"],
  ["lPinky2", "lPinky1"],
  ["lPinky", "lPinky2"],
  ["rHip", "neck"],
  ["lHip", "neck"],
  ["rKnee", "rHip"],
  ["lKnee", "lHip"],
  ["rAnkle", "rKnee"],
  ["rToe", "rAnkle"],
  ["lAnkle", "lKnee"],
  ["lToe", "lAnkle"],
];

const childJoints = new Map<BodyId, BodyId[]>();
for (const [child, parent] of bones) {
  const list = childJoints.get(parent) ?? [];
  list.push(child);
  childJoints.set(parent, list);
}

function descendants(id: BodyId): BodyId[] {
  const out: BodyId[] = [];
  const walk = (current: BodyId) => {
    for (const child of childJoints.get(current) ?? []) {
      out.push(child);
      walk(child);
    }
  };
  walk(id);
  return out;
}

function point(x: number, y: number): Point {
  return { x, y };
}

function hasPoint(value: Point | undefined): value is Point {
  return !!value && Number.isFinite(value.x) && Number.isFinite(value.y);
}

export function fingerTips(wrist: Point, hand: Point): Point[] {
  const dx = (hand.x - wrist.x) * POSE_W;
  const dy = (hand.y - wrist.y) * POSE_H;
  const span = Math.hypot(dx, dy) || 1;
  const length = Math.max(span, 120);
  const ux = dx / span;
  const uy = dy / span;
  const nx = -uy;
  const ny = ux;
  const spreads = [-64, -32, 0, 32, 64];
  const lengths = [0.72, 0.9, 1, 0.86, 0.68];
  return spreads.map((spread, index) => clampPoint({
    x: wrist.x + (ux * length * lengths[index] + nx * spread) / POSE_W,
    y: wrist.y + (uy * length * lengths[index] + ny * spread) / POSE_H,
  }));
}

function along(from: Point, to: Point, t: number): Point {
  return clampPoint({
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  });
}

function fillFinger(pose: Pose, side: "r" | "l", index: number, fallbackTip: Point) {
  const [first, second, tip] = fingerJointIds(side, index);
  if (!hasPoint(pose[tip])) pose[tip] = fallbackTip;
  const wrist = pose[side === "r" ? "rWrist" : "lWrist"];
  if (!hasPoint(pose[first])) pose[first] = along(wrist, pose[tip], 0.42);
  if (!hasPoint(pose[second])) pose[second] = along(pose[first], pose[tip], 0.55);
}

export function withFace(input: Partial<Record<FingerJointId, Point>> & Record<Exclude<BodyId, FingerJointId>, Point>): Pose {
  const nose = input.nose;
  const neck = input.neck;
  const dx = nose.x - neck.x;
  const dy = nose.y - neck.y;
  const len = Math.hypot(dx, dy) || 0.001;
  const fx = dx / len;
  const fy = dy / len;
  const pose = {
    ...input,
    rEye: { x: nose.x - fx * 0.012, y: nose.y - fy * 0.012 - 0.012 },
    lEye: { x: nose.x - fx * 0.022, y: nose.y - fy * 0.01 - 0.004 },
    rEar: { x: nose.x - fx * 0.04, y: nose.y - fy * 0.01 + 0.012 },
    lEar: { x: neck.x + fx * 0.01, y: neck.y - 0.018 },
  } as Pose;
  const right = fingerTips(pose.rWrist, pose.rHand);
  const left = fingerTips(pose.lWrist, pose.lHand);
  rightFingers.forEach((_, index) => fillFinger(pose, "r", index, right[index]));
  leftFingers.forEach((_, index) => fillFinger(pose, "l", index, left[index]));
  return pose;
}

const HAND_PX = 22;
const FOOT_PX = 26;

function extendTip(from: Point, to: Point, extraPx: number): Point {
  const dx = (to.x - from.x) * POSE_W;
  const dy = (to.y - from.y) * POSE_H;
  const length = Math.hypot(dx, dy) || 1;
  return clampPoint({
    x: to.x + (dx / length) * extraPx / POSE_W,
    y: to.y + (dy / length) * extraPx / POSE_H,
  });
}

function body(points: Record<Exclude<BodyId, FingerJointId | "rHand" | "lHand" | "rToe" | "lToe">, [number, number]>): Pose {
  const pose = {} as Record<BodyId, Point>;
  for (const id of Object.keys(points) as Exclude<BodyId, FingerJointId | "rHand" | "lHand" | "rToe" | "lToe">[]) {
    pose[id] = point(points[id][0], points[id][1]);
  }
  pose.rHand = extendTip(pose.rElbow, pose.rWrist, HAND_PX);
  pose.lHand = extendTip(pose.lElbow, pose.lWrist, HAND_PX);
  pose.rToe = extendTip(pose.rKnee, pose.rAnkle, FOOT_PX);
  pose.lToe = extendTip(pose.lKnee, pose.lAnkle, FOOT_PX);
  return withFace(pose);
}

function fingerParent(id: FingerJointId): BodyId {
  if (id.endsWith("1")) return id.startsWith("r") ? "rWrist" : "lWrist";
  if (id.endsWith("2")) return id.slice(0, -1) + "1" as KnuckleId;
  return `${id}2` as KnuckleId;
}

function fingerDescendants(id: FingerJointId): FingerJointId[] {
  if (id.endsWith("1")) return [id.slice(0, -1) + "2" as KnuckleId, id.slice(0, -1) as FingerId];
  if (id.endsWith("2")) return [id.slice(0, -1) as FingerId];
  return [];
}

function rotateAround(origin: Point, target: Point, delta: number): Point {
  const dx = (target.x - origin.x) * POSE_W;
  const dy = (target.y - origin.y) * POSE_H;
  const c = Math.cos(delta);
  const s = Math.sin(delta);
  return clampPoint({
    x: origin.x + (dx * c - dy * s) / POSE_W,
    y: origin.y + (dx * s + dy * c) / POSE_H,
  });
}

function bendFinger(pose: Pose, id: FingerJointId, nextPoint: Point): Pose {
  const origin = pose[fingerParent(id)];
  const current = pose[id];
  const dx = (nextPoint.x - origin.x) * POSE_W;
  const dy = (nextPoint.y - origin.y) * POSE_H;
  const aim = Math.hypot(dx, dy);
  const length = Math.hypot((current.x - origin.x) * POSE_W, (current.y - origin.y) * POSE_H) || 1;
  const placed = aim < 0.5 ? current : clampPoint({
    x: origin.x + (dx / aim) * length / POSE_W,
    y: origin.y + (dy / aim) * length / POSE_H,
  });
  const before = Math.atan2((current.y - origin.y) * POSE_H, (current.x - origin.x) * POSE_W);
  const after = Math.atan2((placed.y - origin.y) * POSE_H, (placed.x - origin.x) * POSE_W);
  let delta = after - before;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const moved: Pose = { ...pose, [id]: placed };
  for (const child of fingerDescendants(id)) moved[child] = rotateAround(origin, pose[child], delta);
  return withFace(moved);
}

function moveArm(pose: Pose, wristId: "rWrist" | "lWrist", target: Point): Pose {
  const side = wristId === "rWrist" ? "r" : "l";
  const shoulderId = side === "r" ? "rShoulder" : "lShoulder";
  const elbowId = side === "r" ? "rElbow" : "lElbow";
  const handId = side === "r" ? "rHand" : "lHand";
  const solved = ikLeg(pose[shoulderId], pose[elbowId], pose[wristId], clampPoint(target));
  const dx = solved.ankle.x - pose[wristId].x;
  const dy = solved.ankle.y - pose[wristId].y;
  const dz = (target.z ?? pose[wristId].z ?? 0) - (pose[wristId].z ?? 0);
  const moved: Pose = {
    ...pose,
    [elbowId]: solved.knee,
    [wristId]: clampPoint({ ...solved.ankle, z: target.z ?? pose[wristId].z }),
  };
  const shift = (joint: BodyId) => {
    moved[joint] = clampPoint({ x: pose[joint].x + dx, y: pose[joint].y + dy, z: (pose[joint].z ?? 0) + dz });
  };
  shift(handId);
  (side === "r" ? rightFingerJoints : leftFingerJoints).forEach(shift);
  return withFace(moved);
}

function shiftedJoints(ids: BodyId[]): BodyId[] {
  const affected = new Set<BodyId>();
  for (const id of ids) {
    affected.add(id);
    for (const child of descendants(id)) affected.add(child);
  }
  return [...affected];
}

export function moveSelection(pose: Pose, ids: BodyId[], target: Point): Pose {
  const unique = [...new Set(ids)];
  const anchor = unique[unique.length - 1];
  if (!anchor) return pose;
  if (unique.length === 1) return moveJoint(pose, anchor, target);
  const placed = clampPoint(target);
  const dx = placed.x - pose[anchor].x;
  const dy = placed.y - pose[anchor].y;
  const dz = (placed.z ?? pose[anchor].z ?? 0) - (pose[anchor].z ?? 0);
  const moved: Pose = { ...pose };
  for (const id of shiftedJoints(unique)) {
    moved[id] = clampPoint({ x: pose[id].x + dx, y: pose[id].y + dy, z: (pose[id].z ?? 0) + dz });
  }
  return withFace(moved);
}

export function moveJoint(pose: Pose, id: BodyId, nextPoint: Point): Pose {
  if (isFingerJoint(id)) return bendFinger(pose, id, nextPoint);
  if (id === "rWrist" || id === "lWrist") return moveArm(pose, id, nextPoint);
  const point = clampPoint(nextPoint);
  const moved: Pose = { ...pose, [id]: point };
  const dx = point.x - pose[id].x;
  const dy = point.y - pose[id].y;
  const dz = (point.z ?? 0) - (pose[id].z ?? 0);
  const shift = (joint: BodyId) => {
    moved[joint] = clampPoint({ x: pose[joint].x + dx, y: pose[joint].y + dy, z: (pose[joint].z ?? 0) + dz });
  };
  if (id === "rHand") rightFingerJoints.forEach(shift);
  if (id === "lHand") leftFingerJoints.forEach(shift);
  if (id === "rAnkle") shift("rToe");
  if (id === "lAnkle") shift("lToe");
  return withFace(moved);
}

function rotateDescendants(pose: Pose, pivot: BodyId, delta: number): Pose {
  const origin = pose[pivot];
  const next: Pose = { ...pose };
  for (const id of descendants(pivot)) next[id] = rotateAround(origin, pose[id], delta);
  return next;
}

export function rotateSelection(pose: Pose, ids: BodyId[], delta: number): Pose {
  const unique = [...new Set(ids)];
  const anchor = unique[unique.length - 1];
  if (!anchor) return pose;
  if (unique.length === 1) return withFace(rotateDescendants(pose, anchor, delta));
  const origin = pose[anchor];
  const next: Pose = { ...pose };
  for (const id of shiftedJoints(unique)) {
    if (id === anchor) continue;
    next[id] = rotateAround(origin, pose[id], delta);
  }
  return withFace(next);
}

function poseVector(point: Point) {
  return { x: point.x - 0.5, y: GROUND_Y - point.y, z: point.z ?? 0 };
}

function vectorPoint(vector: { x: number; y: number; z: number }): Point {
  const point: Point = { x: vector.x + 0.5, y: GROUND_Y - vector.y };
  if (Math.abs(vector.z) > 1e-6) point.z = vector.z;
  return clampPoint(point);
}

function rotateVector(vector: { x: number; y: number; z: number }, axis: { x: number; y: number; z: number }, angle: number) {
  const length = Math.hypot(axis.x, axis.y, axis.z) || 1;
  const x = axis.x / length;
  const y = axis.y / length;
  const z = axis.z / length;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = vector.x * x + vector.y * y + vector.z * z;
  return {
    x: vector.x * cos + (y * vector.z - z * vector.y) * sin + x * dot * (1 - cos),
    y: vector.y * cos + (z * vector.x - x * vector.z) * sin + y * dot * (1 - cos),
    z: vector.z * cos + (x * vector.y - y * vector.x) * sin + z * dot * (1 - cos),
  };
}

export function rotateSelectionAxis(pose: Pose, ids: BodyId[], axis: { x: number; y: number; z: number }, delta: number): Pose {
  const unique = [...new Set(ids)];
  const anchor = unique[unique.length - 1];
  if (!anchor) return pose;
  const pivot = poseVector(pose[anchor]);
  const turning = unique.length === 1 ? descendants(anchor) : shiftedJoints(unique).filter((id) => id !== anchor);
  const next: Pose = { ...pose };
  for (const id of turning) {
    const placed = poseVector(pose[id]);
    const turned = rotateVector(
      { x: placed.x - pivot.x, y: placed.y - pivot.y, z: placed.z - pivot.z },
      axis,
      delta,
    );
    next[id] = vectorPoint({ x: pivot.x + turned.x, y: pivot.y + turned.y, z: pivot.z + turned.z });
  }
  return withFace(next);
}

export function stand(): Pose {
  return body({
    nose: [0.54, 0.15],
    neck: [0.46, 0.23],
    rShoulder: [0.5, 0.27],
    rElbow: [0.55, 0.39],
    rWrist: [0.53, 0.51],
    lShoulder: [0.41, 0.29],
    lElbow: [0.37, 0.41],
    lWrist: [0.36, 0.53],
    rHip: [0.49, 0.5],
    rKnee: [0.5, 0.7],
    rAnkle: [0.51, 0.9],
    lHip: [0.42, 0.52],
    lKnee: [0.41, 0.71],
    lAnkle: [0.4, 0.9],
  });
}

export function walk(): Pose {
  return body({
    nose: [0.56, 0.15],
    neck: [0.48, 0.23],
    rShoulder: [0.51, 0.27],
    rElbow: [0.4, 0.36],
    rWrist: [0.33, 0.46],
    lShoulder: [0.42, 0.29],
    lElbow: [0.52, 0.38],
    lWrist: [0.6, 0.48],
    rHip: [0.5, 0.5],
    rKnee: [0.6, 0.68],
    rAnkle: [0.7, 0.9],
    lHip: [0.42, 0.52],
    lKnee: [0.32, 0.72],
    lAnkle: [0.22, 0.9],
  });
}

export function run(): Pose {
  return body({
    nose: [0.62, 0.16],
    neck: [0.52, 0.24],
    rShoulder: [0.55, 0.28],
    rElbow: [0.4, 0.32],
    rWrist: [0.3, 0.4],
    lShoulder: [0.46, 0.3],
    lElbow: [0.62, 0.36],
    lWrist: [0.74, 0.42],
    rHip: [0.52, 0.5],
    rKnee: [0.68, 0.64],
    rAnkle: [0.8, 0.9],
    lHip: [0.44, 0.52],
    lKnee: [0.34, 0.66],
    lAnkle: [0.16, 0.88],
  });
}

export function punch(): Pose {
  return body({
    nose: [0.55, 0.16],
    neck: [0.47, 0.24],
    rShoulder: [0.52, 0.28],
    rElbow: [0.64, 0.3],
    rWrist: [0.78, 0.28],
    lShoulder: [0.41, 0.3],
    lElbow: [0.36, 0.38],
    lWrist: [0.33, 0.46],
    rHip: [0.5, 0.51],
    rKnee: [0.56, 0.7],
    rAnkle: [0.6, 0.9],
    lHip: [0.42, 0.53],
    lKnee: [0.38, 0.72],
    lAnkle: [0.34, 0.9],
  });
}

function segmentLength(from: Point, to: Point) {
  return Math.hypot((to.x - from.x) * POSE_W, (to.y - from.y) * POSE_H);
}

function bendLeg(hip: Point, target: Point, thigh: number, shin: number, forward: boolean) {
  const knee = { x: hip.x + (forward ? thigh : -thigh) / POSE_W, y: hip.y };
  const ankle = { x: knee.x, y: knee.y + shin / POSE_H };
  return ikLeg(hip, knee, ankle, target);
}

export function crouch(): Pose {
  const upright = stand();
  const pose = body({
    nose: [0.54, 0.36],
    neck: [0.46, 0.43],
    rShoulder: [0.51, 0.47],
    rElbow: [0.62, 0.5],
    rWrist: [0.58, 0.4],
    lShoulder: [0.4, 0.49],
    lElbow: [0.32, 0.56],
    lWrist: [0.3, 0.46],
    rHip: [0.49, 0.64],
    rKnee: [0.62, 0.78],
    rAnkle: [0.56, 0.9],
    lHip: [0.4, 0.66],
    lKnee: [0.32, 0.8],
    lAnkle: [0.3, 0.9],
  });
  for (const [hip, knee, ankle, forward] of [
    ["rHip", "rKnee", "rAnkle", true],
    ["lHip", "lKnee", "lAnkle", false],
  ] as const) {
    const solved = bendLeg(
      pose[hip],
      pose[ankle],
      segmentLength(upright[hip], upright[knee]),
      segmentLength(upright[knee], upright[ankle]),
      forward,
    );
    pose[knee] = solved.knee;
    pose[ankle] = solved.ankle;
  }
  pose.rToe = extendTip(pose.rKnee, pose.rAnkle, FOOT_PX);
  pose.lToe = extendTip(pose.lKnee, pose.lAnkle, FOOT_PX);
  return pose;
}

export const presets: { id: string; label: string; pose: () => Pose }[] = [
  { id: "stand", label: "서기", pose: stand },
  { id: "walk", label: "한 발 앞", pose: walk },
  { id: "run", label: "달리기", pose: run },
  { id: "punch", label: "주먹", pose: punch },
  { id: "crouch", label: "앉기", pose: crouch },
];

export function swapLimbs(pose: Pose): Pose {
  const next = { ...pose };
  const pairs: [BodyId, BodyId][] = [
    ["rShoulder", "lShoulder"],
    ["rElbow", "lElbow"],
    ["rWrist", "lWrist"],
    ["rHand", "lHand"],
    ["rThumb1", "lThumb1"],
    ["rThumb2", "lThumb2"],
    ["rThumb", "lThumb"],
    ["rIndex1", "lIndex1"],
    ["rIndex2", "lIndex2"],
    ["rIndex", "lIndex"],
    ["rMiddle1", "lMiddle1"],
    ["rMiddle2", "lMiddle2"],
    ["rMiddle", "lMiddle"],
    ["rRing1", "lRing1"],
    ["rRing2", "lRing2"],
    ["rRing", "lRing"],
    ["rPinky1", "lPinky1"],
    ["rPinky2", "lPinky2"],
    ["rPinky", "lPinky"],
    ["rHip", "lHip"],
    ["rKnee", "lKnee"],
    ["rAnkle", "lAnkle"],
    ["rToe", "lToe"],
  ];
  for (const [front, back] of pairs) {
    next[front] = pose[back];
    next[back] = pose[front];
  }
  return withFace(next);
}

export const VIEW = { left: -0.15, top: -0.25, width: 1.3, height: 1.3 };

export function clampPoint(value: Point): Point {
  const point: Point = {
    x: Math.min(VIEW.left + VIEW.width - 0.02, Math.max(VIEW.left + 0.02, value.x)),
    y: Math.min(0.97, Math.max(VIEW.top + 0.02, value.y)),
  };
  if (Number.isFinite(value.z)) point.z = Math.min(0.85, Math.max(-0.85, value.z ?? 0));
  return point;
}

export function frameFacing(frame: { facing?: number }) {
  return Number.isFinite(frame.facing) ? frame.facing ?? 0 : 0;
}

const SIDE_DEPTH = 0.5;

function sideSpine(pose: Pose, id: JointId): number | null {
  if (id === "nose" || id === "neck" || id.endsWith("Eye") || id.endsWith("Ear")) return null;
  if (id.includes("Hip") || id.includes("Knee") || id.includes("Ankle") || id.includes("Toe")) {
    return (pose.rHip.x + pose.lHip.x) / 2;
  }
  return pose.neck.x;
}

export function sidePoint(pose: Pose, id: JointId): Point {
  const point = pose[id];
  const spine = sideSpine(pose, id);
  if (spine === null) return point;
  return { x: spine + (point.x - spine) * SIDE_DEPTH, y: point.y };
}

export function posePoint(pose: Pose, id: JointId, displayed: Point): Point {
  const spine = sideSpine(pose, id);
  if (spine === null) return displayed;
  return { x: spine + (displayed.x - spine) / SIDE_DEPTH, y: displayed.y };
}

export function toView(point: Point): Point {
  return { x: (point.x - VIEW.left) / VIEW.width, y: (point.y - VIEW.top) / VIEW.height };
}

export function fromView(point: Point): Point {
  return { x: VIEW.left + point.x * VIEW.width, y: VIEW.top + point.y * VIEW.height };
}

function lerpAngle(a: number, b: number, t: number) {
  let delta = b - a;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}

function toPx(value: Point) {
  return { x: value.x * POSE_W, y: value.y * POSE_H };
}

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const neck = {
    x: a.neck.x + (b.neck.x - a.neck.x) * t,
    y: a.neck.y + (b.neck.y - a.neck.y) * t,
  };
  const out = { neck } as Record<BodyId, Point>;
  for (const [child, parent] of bones) {
    const parentA = toPx(a[parent]);
    const parentB = toPx(b[parent]);
    const childA = toPx(a[child]);
    const childB = toPx(b[child]);
    const angle = lerpAngle(
      Math.atan2(childA.y - parentA.y, childA.x - parentA.x),
      Math.atan2(childB.y - parentB.y, childB.x - parentB.x),
      t,
    );
    const length = Math.hypot(childA.x - parentA.x, childA.y - parentA.y) * (1 - t)
      + Math.hypot(childB.x - parentB.x, childB.y - parentB.y) * t;
    const origin = toPx(out[parent]);
    const z = (a[child].z ?? 0) * (1 - t) + (b[child].z ?? 0) * t;
    out[child] = {
      x: (origin.x + Math.cos(angle) * length) / POSE_W,
      y: (origin.y + Math.sin(angle) * length) / POSE_H,
      ...(Math.abs(z) > 1e-6 ? { z } : {}),
    };
  }
  const neckZ = (a.neck.z ?? 0) * (1 - t) + (b.neck.z ?? 0) * t;
  if (Math.abs(neckZ) > 1e-6) out.neck = { ...out.neck, z: neckZ };
  return withFace(out);
}

function ikLeg(hip: Point, knee: Point, ankle: Point, target: Point) {
  const hipPx = toPx(hip);
  const kneePx = toPx(knee);
  const anklePx = toPx(ankle);
  const targetPx = toPx(target);
  const thigh = Math.max(1, Math.hypot(kneePx.x - hipPx.x, kneePx.y - hipPx.y));
  const shin = Math.max(1, Math.hypot(anklePx.x - kneePx.x, anklePx.y - kneePx.y));
  const dx = targetPx.x - hipPx.x;
  const dy = targetPx.y - hipPx.y;
  let reach = Math.hypot(dx, dy);
  const max = thigh + shin - 0.5;
  const min = Math.abs(thigh - shin) + 0.5;
  let tx = targetPx.x;
  let ty = targetPx.y;
  if (reach > max && reach > 0) {
    tx = hipPx.x + (dx / reach) * max;
    ty = hipPx.y + (dy / reach) * max;
    reach = max;
  } else if (reach < min) {
    const scale = min / Math.max(reach, 0.001);
    tx = hipPx.x + dx * scale;
    ty = hipPx.y + dy * scale;
    reach = min;
  }
  const base = Math.atan2(ty - hipPx.y, tx - hipPx.x);
  const cosine = (thigh * thigh + reach * reach - shin * shin) / (2 * thigh * reach);
  const bend = Math.acos(Math.min(1, Math.max(-1, cosine)));
  const cross = (anklePx.x - hipPx.x) * (kneePx.y - hipPx.y) - (anklePx.y - hipPx.y) * (kneePx.x - hipPx.x);
  const sign = Math.abs(cross) < 8 ? -1 : Math.sign(cross);
  const angle = base + sign * bend;
  return {
    knee: {
      x: (hipPx.x + Math.cos(angle) * thigh) / POSE_W,
      y: (hipPx.y + Math.sin(angle) * thigh) / POSE_H,
    },
    ankle: { x: tx / POSE_W, y: ty / POSE_H },
  };
}

function samePose(a: Pose, b: Pose) {
  return bodyIds.every((id) => Math.abs(a[id].x - b[id].x) < 0.0008 && Math.abs(a[id].y - b[id].y) < 0.0008);
}

function keyIndexes(frames: Frame[]) {
  const keys: number[] = [];
  frames.forEach((frame, index) => {
    if (frame.key || index === 0 || index === frames.length - 1) keys.push(index);
  });
  return keys;
}

export function recompute(frames: Frame[]): Frame[] {
  const keys = keyIndexes(frames);
  return frames.map((frame, index) => {
    if (keys.includes(index)) return { ...frame, key: true, facing: frameFacing(frame) };
    let prev = keys[0];
    let next = keys[keys.length - 1];
    for (const key of keys) {
      if (key < index) prev = key;
      if (key > index) {
        next = key;
        break;
      }
    }
    const t = (index - prev) / (next - prev);
    const pose = lerpPose(frames[prev].pose, frames[next].pose, t);
    const facing = frameFacing(frames[prev]) + (frameFacing(frames[next]) - frameFacing(frames[prev])) * t;
    return { pose, key: false, facing, image: samePose(frame.pose, pose) ? frame.image : undefined };
  });
}

export function editFacing(frames: Frame[], index: number, facing: number): Frame[] {
  const next = frames.map((frame, frameIndex) => (
    frameIndex === index ? { ...frame, facing, key: true, image: undefined } : frame
  ));
  return recompute(next);
}

export function facingAt(frames: Frame[], t: number) {
  const span = Math.max(1, frames.length - 1);
  const pos = Math.min(1, Math.max(0, t)) * span;
  const prev = Math.min(frames.length - 1, Math.floor(pos));
  const next = Math.min(frames.length - 1, prev + 1);
  if (prev === next || pos - prev < 0.0001) return frameFacing(frames[prev]);
  if (next - pos < 0.0001) return frameFacing(frames[next]);
  const blend = pos - prev;
  return frameFacing(frames[prev]) + (frameFacing(frames[next]) - frameFacing(frames[prev])) * blend;
}

export function editFrame(frames: Frame[], index: number, pose: Pose): Frame[] {
  const next = frames.map((frame, frameIndex) => (
    frameIndex === index ? { ...frame, pose: withFace(pose), key: true, image: undefined } : frame
  ));
  return recompute(next);
}

export function unlockFrame(frames: Frame[], index: number): Frame[] {
  if (index <= 0 || index >= frames.length - 1) return frames;
  return recompute(frames.map((frame, frameIndex) => (
    frameIndex === index ? { ...frame, key: false } : frame
  )));
}

export function unlockMiddles(frames: Frame[]): Frame[] {
  return recompute(frames.map((frame, index) => (
    index === 0 || index === frames.length - 1 ? frame : { ...frame, key: false }
  )));
}

export function resizeTimeline(frames: Frame[], count: number): Frame[] {
  const nextCount = Math.max(2, Math.min(8, Math.round(count)));
  const next: Frame[] = Array.from({ length: nextCount }, () => ({ pose: frames[0].pose, key: false }));
  next[0] = { pose: frames[0].pose, key: true, image: frames[0].image };
  next[nextCount - 1] = { pose: frames[frames.length - 1].pose, key: true, image: frames[frames.length - 1].image };
  const span = frames.length - 1;
  for (let index = 1; index < frames.length - 1; index += 1) {
    if (!frames[index].key) continue;
    const dest = Math.round((index / span) * (nextCount - 1));
    if (dest <= 0 || dest >= nextCount - 1) continue;
    next[dest] = { pose: frames[index].pose, key: true, image: frames[index].image };
  }
  return recompute(next);
}

export const poseMotions = ["idle", "walk", "run", "attack", "hurt", "death"] as const;

export function hurt(): Pose {
  return body({
    nose: [0.4, 0.16],
    neck: [0.38, 0.25],
    rShoulder: [0.42, 0.3],
    rElbow: [0.34, 0.4],
    rWrist: [0.28, 0.5],
    lShoulder: [0.33, 0.32],
    lElbow: [0.26, 0.42],
    lWrist: [0.22, 0.52],
    rHip: [0.44, 0.52],
    rKnee: [0.38, 0.7],
    rAnkle: [0.42, 0.9],
    lHip: [0.36, 0.54],
    lKnee: [0.3, 0.72],
    lAnkle: [0.28, 0.9],
  });
}

export function defaultTimeline(motion: string, count = 6): Frame[] {
  const end = motion === "walk" ? walk()
    : motion === "run" ? run()
    : motion === "hurt" ? hurt()
    : motion === "death" ? crouch()
    : stand();
  const frames: Frame[] = Array.from({ length: count }, () => ({ pose: stand(), key: false }));
  frames[0] = { pose: stand(), key: true };
  frames[count - 1] = { pose: end, key: true };
  if (motion === "attack") frames[Math.floor(count / 2)] = { pose: punch(), key: true };
  return recompute(frames);
}

export function makeTimeline(count = 6): Frame[] {
  return defaultTimeline("walk", count);
}

export function poseAt(frames: Frame[], t: number): Pose {
  const span = Math.max(1, frames.length - 1);
  const pos = Math.min(1, Math.max(0, t)) * span;
  const prev = Math.min(frames.length - 1, Math.floor(pos));
  const next = Math.min(frames.length - 1, prev + 1);
  if (prev === next || pos - prev < 0.0001) return frames[prev].pose;
  if (next - pos < 0.0001) return frames[next].pose;
  return lerpPose(frames[prev].pose, frames[next].pose, pos - prev);
}

export function frameLabel(index: number, count: number, key: boolean) {
  if (index === 0) return "시작";
  if (index === count - 1) return "끝";
  return key ? "수정" : "보간";
}

export function poseCostUsd() {
  return (POSE_W * POSE_H) / 1_000_000 * 0.075;
}

const coreIds: Exclude<BodyId, "rHand" | "lHand" | "rToe" | "lToe">[] = [
  "nose", "neck",
  "rShoulder", "rElbow", "rWrist",
  "lShoulder", "lElbow", "lWrist",
  "rHip", "rKnee", "rAnkle",
  "lHip", "lKnee", "lAnkle",
];

function readBody(value: unknown): Record<BodyId, Point> {
  if (!value || typeof value !== "object") throw new Error("pose");
  const raw = value as Partial<Record<BodyId, Point>>;
  const pose = {} as Record<BodyId, Point>;
  for (const id of coreIds) {
    const pointValue = raw[id];
    if (!pointValue || !Number.isFinite(pointValue.x) || !Number.isFinite(pointValue.y)) throw new Error("pose");
    pose[id] = {
      x: pointValue.x,
      y: pointValue.y,
      ...(Number.isFinite(pointValue.z) ? { z: pointValue.z } : {}),
    };
  }
  const kept = (id: BodyId) => {
    const pointValue = raw[id];
    return pointValue && Number.isFinite(pointValue.x) && Number.isFinite(pointValue.y)
      ? { x: pointValue.x, y: pointValue.y, ...(Number.isFinite(pointValue.z) ? { z: pointValue.z } : {}) }
      : null;
  };
  pose.rHand = kept("rHand") ?? extendTip(pose.rElbow, pose.rWrist, HAND_PX);
  pose.lHand = kept("lHand") ?? extendTip(pose.lElbow, pose.lWrist, HAND_PX);
  pose.rToe = kept("rToe") ?? extendTip(pose.rKnee, pose.rAnkle, FOOT_PX);
  pose.lToe = kept("lToe") ?? extendTip(pose.lKnee, pose.lAnkle, FOOT_PX);
  const right = fingerTips(pose.rWrist, pose.rHand);
  const left = fingerTips(pose.lWrist, pose.lHand);
  rightFingers.forEach((_, index) => {
    const [first, second, tip] = fingerJointIds("r", index);
    pose[tip] = kept(tip) ?? right[index];
    pose[first] = kept(first) ?? along(pose.rWrist, pose[tip], 0.42);
    pose[second] = kept(second) ?? along(pose[first], pose[tip], 0.55);
  });
  leftFingers.forEach((_, index) => {
    const [first, second, tip] = fingerJointIds("l", index);
    pose[tip] = kept(tip) ?? left[index];
    pose[first] = kept(first) ?? along(pose.lWrist, pose[tip], 0.42);
    pose[second] = kept(second) ?? along(pose[first], pose[tip], 0.55);
  });
  return pose;
}

export function readJoints(value: unknown): Pose {
  return withFace(readBody(value));
}

type StoredFrame = { pose: unknown; key?: boolean; facing?: number };
type PoseStore = { plant?: boolean; frames?: StoredFrame[]; byMotion?: Record<string, StoredFrame[]> };

function parseFrames(frames: StoredFrame[]) {
  if (frames.length < 2 || frames.length > 8) throw new Error("pose");
  const parsed = frames.map((frame, index, all) => {
    return {
      pose: withFace(readBody(frame.pose)),
      key: index === 0 || index === all.length - 1 || Boolean(frame.key),
      facing: frameFacing(frame),
    };
  });
  return recompute(parsed);
}

function readStore(): PoseStore {
  try {
    const raw = localStorage.getItem("pp-pose");
    if (!raw) return {};
    return JSON.parse(raw) as PoseStore;
  } catch {
    return {};
  }
}

function migrate(store: PoseStore): { plant: boolean; byMotion: Record<string, StoredFrame[]> } {
  const byMotion = { ...(store.byMotion ?? {}) };
  if (store.frames && !byMotion.walk) byMotion.walk = store.frames;
  return { plant: store.plant !== false, byMotion };
}

export function loadMotion(motion: string): { frames: Frame[] } {
  const store = migrate(readStore());
  const saved = store.byMotion[motion];
  if (saved) {
    try {
      return { frames: parseFrames(saved) };
    } catch {
      return { frames: defaultTimeline(motion) };
    }
  }
  return { frames: defaultTimeline(motion) };
}

const motionListeners = new Set<() => void>();

export function motionTurns(motion: string) {
  const frames = migrate(readStore()).byMotion[motion] ?? [];
  return frames.some((frame) => Math.abs(frameFacing(frame)) > 5);
}

export function subscribeMotions(listener: () => void) {
  motionListeners.add(listener);
  return () => {
    motionListeners.delete(listener);
  };
}

export function saveMotion(motion: string, frames: Frame[]) {
  const store = migrate(readStore());
  store.byMotion[motion] = frames.map(({ pose, key, facing }) => ({
    pose,
    key,
    ...(Math.abs(frameFacing({ facing })) > 0.05 ? { facing: frameFacing({ facing }) } : {}),
  }));
  localStorage.setItem("pp-pose", JSON.stringify({ plant: store.plant, byMotion: store.byMotion }));
  for (const listener of motionListeners) listener();
}

export function adoptMotion(from: string, to: string) {
  if (!from || from === to) return;
  const store = migrate(readStore());
  if (store.byMotion[to] || !store.byMotion[from]) return;
  store.byMotion[to] = store.byMotion[from];
  localStorage.setItem("pp-pose", JSON.stringify({ plant: store.plant, byMotion: store.byMotion }));
  for (const listener of motionListeners) listener();
}

export function copyMotion(from: string, to: string) {
  if (from === to) return;
  const store = migrate(readStore());
  const frames = store.byMotion[from];
  if (!frames) return;
  store.byMotion[to] = frames;
  localStorage.setItem("pp-pose", JSON.stringify({ plant: store.plant, byMotion: store.byMotion }));
  for (const listener of motionListeners) listener();
}

export function resetMotion(motion: string) {
  saveMotion(motion, defaultTimeline("custom"));
}

let carryId = "";

export function carryMotionTo(id: string) {
  carryId = id;
}

export function takeCarry(id: string) {
  if (carryId !== id) return false;
  carryId = "";
  return true;
}

export function loadTimeline(): { frames: Frame[] } {
  return loadMotion("walk");
}
