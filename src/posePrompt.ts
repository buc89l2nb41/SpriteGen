import {
  clampPoint,
  crouch,
  fingerJointIds,
  GROUND_Y,
  isFingerJoint,
  jointLabel,
  readJoints,
  POSE_H,
  POSE_W,
  presets,
  punch,
  recompute,
  run,
  leftFingerJoints,
  rightFingerJoints,
  stand,
  VIEW,
  walk,
  withFace,
  type BodyId,
  type Frame,
  type Point,
  type Pose,
} from "./pose";

export const POSE_STEP = 0.06;

const bodyIds: BodyId[] = [
  "nose", "neck",
  "rShoulder", "rElbow", "rWrist", "rHand",
  ...rightFingerJoints,
  "lShoulder", "lElbow", "lWrist", "lHand",
  ...leftFingerJoints,
  "rHip", "rKnee", "rAnkle", "rToe",
  "lHip", "lKnee", "lAnkle", "lToe",
];

const names: [string, BodyId[]][] = [
  ["오른팔꿈치", ["rElbow"]],
  ["왼팔꿈치", ["lElbow"]],
  ["앞팔꿈치", ["rElbow"]],
  ["뒤팔꿈치", ["lElbow"]],
  ["오른어깨", ["rShoulder"]],
  ["왼어깨", ["lShoulder"]],
  ["앞어깨", ["rShoulder"]],
  ["뒤어깨", ["lShoulder"]],
  ["오른손끝", ["rHand"]],
  ["왼손끝", ["lHand"]],
  ["앞손끝", ["rHand"]],
  ["뒤손끝", ["lHand"]],
  ["오른손목", ["rWrist"]],
  ["왼손목", ["lWrist"]],
  ["앞손목", ["rWrist"]],
  ["뒤손목", ["lWrist"]],
  ["오른손", ["rWrist"]],
  ["왼손", ["lWrist"]],
  ["앞손", ["rWrist"]],
  ["뒤손", ["lWrist"]],
  ["오른골반", ["rHip"]],
  ["왼골반", ["lHip"]],
  ["앞골반", ["rHip"]],
  ["뒤골반", ["lHip"]],
  ["오른무릎", ["rKnee"]],
  ["왼무릎", ["lKnee"]],
  ["앞무릎", ["rKnee"]],
  ["뒤무릎", ["lKnee"]],
  ["오른발끝", ["rToe"]],
  ["왼발끝", ["lToe"]],
  ["앞발끝", ["rToe"]],
  ["뒤발끝", ["lToe"]],
  ["오른발목", ["rAnkle"]],
  ["왼발목", ["lAnkle"]],
  ["앞발목", ["rAnkle"]],
  ["뒤발목", ["lAnkle"]],
  ["오른발", ["rAnkle"]],
  ["왼발", ["lAnkle"]],
  ["앞발", ["rAnkle"]],
  ["뒤발", ["lAnkle"]],
  ["팔꿈치", ["rElbow", "lElbow"]],
  ["어깨", ["rShoulder", "lShoulder"]],
  ["무릎", ["rKnee", "lKnee"]],
  ["골반", ["rHip", "lHip"]],
  ["손끝", ["rHand", "lHand"]],
  ["발끝", ["rToe", "lToe"]],
  ["손목", ["rWrist", "lWrist"]],
  ["발목", ["rAnkle", "lAnkle"]],
  ["손", ["rWrist", "lWrist"]],
  ["발", ["rAnkle", "lAnkle"]],
  ["머리", ["nose"]],
  ["목", ["neck"]],
];

const bends = new Set<BodyId>(["rElbow", "lElbow", "rKnee", "lKnee"]);

function copyBody(pose: Pose): Record<BodyId, Point> {
  const next = {} as Record<BodyId, Point>;
  for (const id of bodyIds) next[id] = { ...pose[id] };
  return next;
}

function mentioned(text: string) {
  const found = new Set<BodyId>();
  let rest = text;
  for (const [label, ids] of names) {
    if (!rest.includes(label)) continue;
    for (const id of ids) found.add(id);
    rest = rest.split(label).join(" ");
  }
  return [...found];
}

function parentOf(id: BodyId): BodyId | null {
  if (id === "rHand") return "rWrist";
  if (id === "lHand") return "lWrist";
  if (id === "rToe") return "rAnkle";
  if (id === "lToe") return "lAnkle";
  if (id === "rElbow" || id === "rWrist") return id === "rWrist" ? "rElbow" : "rShoulder";
  if (id === "lElbow" || id === "lWrist") return id === "lWrist" ? "lElbow" : "lShoulder";
  if (id === "rKnee" || id === "rAnkle") return id === "rAnkle" ? "rKnee" : "rHip";
  if (id === "lKnee" || id === "lAnkle") return id === "lAnkle" ? "lKnee" : "lHip";
  return null;
}

function childOf(id: BodyId): BodyId | null {
  if (id === "rElbow") return "rWrist";
  if (id === "lElbow") return "lWrist";
  if (id === "rWrist") return "rHand";
  if (id === "lWrist") return "lHand";
  if (id === "rKnee") return "rAnkle";
  if (id === "lKnee") return "lAnkle";
  if (id === "rAnkle") return "rToe";
  if (id === "lAnkle") return "lToe";
  return null;
}

function awayFromLine(pose: Pose, id: BodyId): Point {
  const parent = parentOf(id);
  const child = childOf(id);
  const point = pose[id];
  if (!parent || !child) return point;
  const from = pose[parent];
  const to = pose[child];
  const abx = to.x - from.x;
  const aby = to.y - from.y;
  const length = abx * abx + aby * aby || 1e-6;
  const t = ((point.x - from.x) * abx + (point.y - from.y) * aby) / length;
  const lineX = from.x + abx * t;
  const lineY = from.y + aby * t;
  let px = point.x - lineX;
  let py = point.y - lineY;
  if (px * px + py * py < 1e-8) {
    const forward = -aby >= aby ? -aby : aby;
    const down = -aby >= aby ? abx : -abx;
    px = forward;
    py = down;
  }
  const span = Math.hypot(px, py) || 1;
  return { x: point.x + px / span, y: point.y + py / span };
}

function ontoLine(pose: Pose, id: BodyId): Point {
  const parent = parentOf(id);
  const child = childOf(id);
  const point = pose[id];
  if (!parent || !child) return point;
  const from = pose[parent];
  const to = pose[child];
  const abx = to.x - from.x;
  const aby = to.y - from.y;
  const length = abx * abx + aby * aby || 1e-6;
  const t = Math.min(1, Math.max(0, ((point.x - from.x) * abx + (point.y - from.y) * aby) / length));
  return { x: from.x + abx * t, y: from.y + aby * t };
}

function shift(point: Point, x: number, y: number): Point {
  return { x: point.x + x, y: point.y + y };
}

function sentencePose(current: Pose, text: string) {
  const trimmed = text.trim();
  const preset = presets.find((item) => trimmed === item.label);
  if (preset) return { pose: copyBody(preset.pose()), touched: new Set(bodyIds) };
  const ids = mentioned(text);
  const verb = /굽|구부|펴|앞|뒤|올|위|내|아래/.test(text);
  const targets = ids.length > 0 ? ids : verb ? [...bends] : [];
  if (targets.length === 0) {
    throw new Error("장풍, 주먹, 앉기처럼 동작을 적거나, 앞무릎을 굽혀처럼 관절을 적어 주세요. 관절 JSON도 받을 수 있습니다.");
  }
  const next = copyBody(current);
  for (const id of targets) {
    if (/굽|구부/.test(text)) next[id] = awayFromLine(current, id);
    else if (text.includes("펴")) next[id] = ontoLine(current, id);
    else if (text.includes("앞")) next[id] = shift(current[id], 1, 0);
    else if (text.includes("뒤")) next[id] = shift(current[id], -1, 0);
    else if (/올|위/.test(text)) next[id] = shift(current[id], 0, -1);
    else if (/내|아래/.test(text)) next[id] = shift(current[id], 0, 1);
    else throw new Error("굽혀, 펴, 앞, 뒤, 위, 아래 중 하나로 적어 주세요.");
  }
  return { pose: next, touched: new Set(targets) };
}

function jsonPose(text: string) {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("관절 JSON 형식이 올바르지 않습니다.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("관절 JSON은 객체여야 합니다.");
  const record = data as Record<string, unknown>;
  const next = copyBody(stand());
  const touched = new Set<BodyId>();
  for (const id of bodyIds) {
    const value = record[id];
    if (value === undefined) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${id} 좌표가 없습니다.`);
    const point = value as { x?: unknown; y?: unknown };
    if (typeof point.x !== "number" || typeof point.y !== "number" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error(`${id} 좌표는 숫자여야 합니다.`);
    }
    next[id] = { x: point.x, y: point.y };
    touched.add(id);
  }
  if (touched.size === 0) throw new Error("아는 관절 이름이 JSON에 없습니다.");
  return { pose: next, touched };
}

function limitPose(current: Pose, proposed: Record<BodyId, Point>, touched: Set<BodyId>) {
  const next = copyBody(current);
  let moved = 0;
  for (const id of touched) {
    const target = proposed[id];
    const dx = target.x - current[id].x;
    const dy = target.y - current[id].y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-4) continue;
    const scale = distance > POSE_STEP ? POSE_STEP / distance : 1;
    next[id] = clampPoint({ x: current[id].x + dx * scale, y: current[id].y + dy * scale });
    moved += 1;
  }
  return { pose: withFace(next), moved };
}

export function poseFromPrompt(current: Pose, text: string) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("자세 문장이나 관절 JSON을 입력하세요.");
  const proposed = trimmed.startsWith("{") ? jsonPose(trimmed) : sentencePose(current, trimmed);
  const limited = limitPose(current, proposed.pose, proposed.touched);
  const note = limited.moved === 0
    ? "이미 그 자리에 가깝습니다."
    : `${limited.moved}개 관절을 지금 자리에서 ${POSE_STEP} 이내로 옮겼습니다.`;
  return { pose: limited.pose, note, moved: limited.moved };
}

const HAND_PX = 22;
const FOOT_PX = 26;

function pixels(from: Point, to: Point) {
  return Math.hypot((to.x - from.x) * POSE_W, (to.y - from.y) * POSE_H);
}

function along(origin: Point, toward: Point, lengthPx: number, clamp = true): Point {
  const dx = (toward.x - origin.x) * POSE_W;
  const dy = (toward.y - origin.y) * POSE_H;
  const span = Math.hypot(dx, dy) || 1;
  const point = {
    x: origin.x + (dx / span) * lengthPx / POSE_W,
    y: origin.y + (dy / span) * lengthPx / POSE_H,
  };
  return clamp ? clampPoint(point) : point;
}

export function fitAnalyzed(raw: Pose, clamp = true): Pose {
  const rest = stand();
  const next = copyBody(raw);
  const arms = [
    ["rShoulder", "rElbow", "rWrist", "rHand"],
    ["lShoulder", "lElbow", "lWrist", "lHand"],
  ] as const;
  for (const [shoulder, elbow, wrist, hand] of arms) {
    const upper = pixels(rest[shoulder], rest[elbow]);
    const lower = pixels(rest[elbow], rest[wrist]);
    next[elbow] = along(next[shoulder], raw[elbow], upper, clamp);
    next[wrist] = along(next[elbow], raw[wrist], lower, clamp);
    next[hand] = along(next[elbow], next[wrist], lower + HAND_PX, clamp);
  }
  const legs = [
    ["rHip", "rKnee", "rAnkle", "rToe"],
    ["lHip", "lKnee", "lAnkle", "lToe"],
  ] as const;
  for (const [hip, knee, ankle, toe] of legs) {
    const thigh = pixels(rest[hip], rest[knee]);
    const shin = pixels(rest[knee], rest[ankle]);
    next[knee] = along(next[hip], raw[knee], thigh, clamp);
    next[ankle] = along(next[knee], raw[ankle], shin, clamp);
    next[toe] = along(next[knee], next[ankle], shin + FOOT_PX, clamp);
  }
  for (const side of ["r", "l"] as const) {
    for (let finger = 0; finger < 5; finger += 1) {
      const chain: BodyId[] = [side === "r" ? "rWrist" : "lWrist", ...fingerJointIds(side, finger)];
      for (let joint = 1; joint < chain.length; joint += 1) {
        const parent = chain[joint - 1];
        const child = chain[joint];
        const toward = {
          x: next[parent].x + raw[child].x - raw[parent].x,
          y: next[parent].y + raw[child].y - raw[parent].y,
        };
        next[child] = along(next[parent], toward, pixels(rest[parent], rest[child]), clamp);
      }
    }
  }
  return withFace(next);
}

const limbs: [BodyId, BodyId][] = [
  ["rShoulder", "rElbow"], ["rElbow", "rWrist"],
  ["lShoulder", "lElbow"], ["lElbow", "lWrist"],
  ["rHip", "rKnee"], ["rKnee", "rAnkle"],
  ["lHip", "lKnee"], ["lKnee", "lAnkle"],
];

function middle(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function fitCoords(value: unknown, inPlace: boolean) {
  let read: Pose;
  try {
    read = readJoints(value);
  } catch {
    throw new Error("AI가 적은 관절 좌표에 빠진 관절이 있습니다. 다시 만들어 주세요.");
  }
  const rest = stand();
  const hip = middle(read.rHip, read.lHip);
  const flip = !inPlace && read.nose.x < hip.x;
  const srcShoulder = middle(read.rShoulder, read.lShoulder);
  const srcHeight = Math.hypot(srcShoulder.x - hip.x, (srcShoulder.y - hip.y) * POSE_H / POSE_W);
  if (srcHeight < 0.03) throw new Error("AI가 적은 몸통이 너무 작습니다. 다시 만들어 주세요.");
  const restHip = middle(rest.rHip, rest.lHip);
  const restShoulder = middle(rest.rShoulder, rest.lShoulder);
  const scale = Math.hypot(restShoulder.x - restHip.x, (restShoulder.y - restHip.y) * POSE_H / POSE_W) / srcHeight;
  const dstHip = inPlace ? hip : restHip;
  const placed = copyBody(read);
  for (const id of bodyIds) {
    const dx = (flip ? hip.x - read[id].x : read[id].x - hip.x) * scale;
    placed[id] = { x: dstHip.x + dx, y: dstHip.y + (read[id].y - hip.y) * scale };
  }
  const worst = Math.max(...limbs.map(([a, b]) => Math.abs(pixels(placed[a], placed[b]) / pixels(rest[a], rest[b]) - 1)));
  const fitted = fitAnalyzed(withFace(placed), false);
  for (const side of ["r", "l"] as const) {
    const wrist = side === "r" ? "rWrist" : "lWrist";
    const knuckles = [1, 2, 3, 4].map((finger) => fitted[fingerJointIds(side, finger)[0]]);
    const palm = {
      x: knuckles.reduce((sum, point) => sum + point.x, 0) / knuckles.length,
      y: knuckles.reduce((sum, point) => sum + point.y, 0) / knuckles.length,
    };
    fitted[side === "r" ? "rHand" : "lHand"] = along(fitted[wrist], palm, HAND_PX, false);
  }
  return { fitted, scale, worst };
}

export function poseFromFeedback(value: unknown, current: Pose): { pose: Pose; adjust: string } {
  const { fitted, worst } = fitCoords(value, true);
  const next = copyBody(fitted);
  for (const id of bodyIds) next[id] = clampPoint(fitted[id]);
  const pose = withFace(next);
  const moved = (Object.keys(jointLabel) as BodyId[]).filter((id) => (
    !isFingerJoint(id) && Math.hypot(pose[id].x - current[id].x, pose[id].y - current[id].y) > 0.01
  ));
  const fingers = bodyIds.some((id) => isFingerJoint(id) && Math.hypot(pose[id].x - current[id].x, pose[id].y - current[id].y) > 0.01);
  const names = moved.slice(0, 6).map((id) => jointLabel[id]).join(", ") + (moved.length > 6 ? ` 외 ${moved.length - 6}개` : "");
  const what = moved.length > 0
    ? `옮긴 관절: ${names}${fingers ? ", 손가락" : ""}.`
    : fingers ? "손가락만 옮겼습니다." : "AI가 거의 바꾸지 않았습니다. 피드백을 더 구체적으로 적어 보세요.";
  const fixed = Math.round(worst * 100);
  return {
    pose,
    adjust: `피드백을 반영했습니다. ${what}${fixed >= 3 ? ` 팔다리 길이가 최대 ${fixed}% 달라 이 몸 길이로 고쳤습니다.` : ""}`,
  };
}

export function poseFromCoords(value: unknown, airborne: boolean): { pose: Pose; adjust: string } {
  const { fitted, scale, worst } = fitCoords(value, false);
  const edge = { top: VIEW.top + 0.03, left: VIEW.left + 0.03, right: VIEW.left + VIEW.width - 0.03 };
  const xs = bodyIds.map((id) => fitted[id].x);
  const top = Math.min(...bodyIds.map((id) => fitted[id].y));
  const low = Math.max(fitted.rAnkle.y, fitted.rToe.y, fitted.lAnkle.y, fitted.lToe.y);
  let dy = airborne ? (low > 0.8 ? 0.78 - low : 0) : GROUND_Y - low;
  if (airborne && top + dy < edge.top) dy = Math.min(edge.top - top, GROUND_Y - low);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const dx = left < edge.left
    ? Math.min(edge.left - left, edge.right - right)
    : right > edge.right ? Math.max(edge.right - right, edge.left - left) : 0;
  const pose = shiftBody(fitted, dy, dx);
  const squeezed = top + dy < edge.top - 0.01 || left + dx < edge.left - 0.01 || right + dx > edge.right + 0.01;
  const size = Math.round(scale * 100);
  const fixed = Math.round(worst * 100);
  const lengths = fixed < 3
    ? `AI 좌표를 이 몸에 올렸습니다. 크기만 ${size}%로 맞췄고 팔다리 길이는 그대로 맞았습니다.`
    : `AI 좌표를 이 몸에 올렸습니다. 크기를 ${size}%로 맞추고, 팔다리 길이가 최대 ${fixed}% 달라 이 몸 길이로 고쳤습니다. 방향은 그대로입니다.`;
  return {
    pose,
    adjust: squeezed ? `${lengths} 몸이 편집 화면보다 커서 밖으로 나간 끝은 가장자리에 붙였습니다.` : lengths,
  };
}

export function promptReadsMotion(text: string) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("[")) return false;
  return mentioned(trimmed).length === 0;
}

function explainMotion(text: string) {
  const named = text
    .replace(/승룡권|승룡/g, "⟦shoryu⟧")
    .replace(/장풍/g, "⟦hadou⟧")
    .replace(/발차기|킥/g, "⟦kick⟧");
  return named
    .replace(/펀치|주먹/g, "⟦punch⟧")
    .replaceAll("⟦shoryu⟧", "몸을 낮춘 뒤 떠오르며 앞주먹을 위로")
    .replaceAll("⟦hadou⟧", "두 손을 허리에 모았다가 두 손을 앞으로")
    .replaceAll("⟦kick⟧", "앞발을 앞으로")
    .replaceAll("⟦punch⟧", "앞주먹을 앞으로");
}

function shiftBody(pose: Pose, dy: number, dx = 0): Pose {
  const next = copyBody(pose);
  for (const id of bodyIds) next[id] = clampPoint({ x: pose[id].x + dx, y: pose[id].y + dy });
  return withFace(next);
}

function phrasePose(phrase: string): Pose {
  if (/낮|웅크|앉/.test(phrase) && !/떠|점프/.test(phrase)) return crouch();
  if (/떠|점프|위로/.test(phrase) && /주먹|손/.test(phrase)) {
    const raised = shiftBody(stand(), -0.16);
    raised.rElbow = { x: raised.rShoulder.x + 0.1, y: raised.rShoulder.y - 0.08 };
    raised.rWrist = { x: raised.rShoulder.x + 0.02, y: raised.nose.y - 0.08 };
    raised.lElbow = { x: raised.lShoulder.x - 0.02, y: raised.lShoulder.y + 0.08 };
    raised.lWrist = { x: raised.lHip.x, y: raised.lHip.y };
    return fitAnalyzed(raised);
  }
  if (/허리/.test(phrase) && /손/.test(phrase)) {
    const pose = stand();
    pose.rElbow = { x: pose.rShoulder.x - 0.06, y: pose.rShoulder.y + 0.1 };
    pose.rWrist = { x: pose.rHip.x - 0.08, y: pose.rHip.y };
    pose.lElbow = { x: pose.lShoulder.x - 0.04, y: pose.lShoulder.y + 0.1 };
    pose.lWrist = { x: pose.lHip.x - 0.06, y: pose.lHip.y };
    return fitAnalyzed(pose);
  }
  if (/앞/.test(phrase) && /두 손|양손/.test(phrase)) {
    const pose = stand();
    pose.rElbow = { x: pose.rShoulder.x + 0.14, y: pose.rShoulder.y };
    pose.rWrist = { x: pose.rShoulder.x + 0.28, y: pose.rShoulder.y };
    pose.lElbow = { x: pose.lShoulder.x + 0.12, y: pose.lShoulder.y };
    pose.lWrist = { x: pose.lShoulder.x + 0.24, y: pose.lShoulder.y };
    return fitAnalyzed(pose);
  }
  if (/앞/.test(phrase) && /주먹|손/.test(phrase)) return punch();
  if (/앞/.test(phrase) && /발/.test(phrase)) {
    const pose = stand();
    pose.rKnee = { x: pose.rHip.x + 0.12, y: pose.rHip.y + 0.02 };
    pose.rAnkle = { x: pose.rHip.x + 0.28, y: pose.rHip.y };
    return fitAnalyzed(pose);
  }
  if (/달리/.test(phrase)) return run();
  if (/걷|한 발/.test(phrase)) return walk();
  return stand();
}

function momentLabel(phrase: string) {
  const label = phrase.replace(/쓰는|모션을?|만들어\s*줘|해\s*줘/g, " ").replace(/\s+/g, " ").trim();
  return label || phrase.trim();
}

export function motionMoments(text: string): string[] {
  const trimmed = text.trim();
  if (!promptReadsMotion(trimmed)) throw new Error("관절을 적은 문장은 키 칸만 조금 옮깁니다.");
  const explained = explainMotion(trimmed);
  const parts = explained.split(/뒤|다가|했다가|모았다가|그리고/).map((part) => part.trim()).filter(Boolean);
  const phrases = parts.length > 0 ? parts : [explained];
  const poses = phrases.map(phrasePose);
  const changed = poses.some((pose) => bodyIds.some((id) => Math.hypot(pose[id].x - stand()[id].x, pose[id].y - stand()[id].y) > 0.03));
  if (!changed && !/서/.test(trimmed)) {
    throw new Error("이 문장을 몸의 동작으로 풀지 못했습니다. 낮추기, 주먹을 위로, 손을 앞으로처럼 적어도 됩니다.");
  }
  const labels = phrases.map(momentLabel);
  if (changed && !/착지|다시 서/.test(labels[labels.length - 1] ?? "")) labels.push("착지");
  return labels;
}

export function timelineFromMomentPoses(frames: Frame[], poses: Pose[]) {
  if (poses.length < 1 || poses.length > 6) throw new Error("확인한 자세는 1개에서 6개여야 합니다.");
  const sequence = [stand(), ...poses];
  const spread = spreadPoses(frames.length, sequence, Math.max(0, sequence.length - 2));
  return { ...spread, note: `고른 그림 ${poses.length}장으로 ${frames.length}칸을 채웠습니다.` };
}

function posesFromSentence(text: string): Pose[] {
  const explained = explainMotion(text);
  const parts = explained.split(/뒤|다가|했다가|모았다가|그리고/).map((part) => part.trim()).filter(Boolean);
  const poses = (parts.length > 0 ? parts : [explained]).map(phrasePose);
  const changed = poses.some((pose) => pose !== stand() && bodyIds.some((id) => Math.hypot(pose[id].x - stand()[id].x, pose[id].y - stand()[id].y) > 0.03));
  if (!changed && !/서/.test(text)) throw new Error("이 문장을 몸의 동작으로 풀지 못했습니다. 낮추기, 주먹을 위로, 손을 앞으로처럼 적어도 됩니다.");
  if (poses.length === 1 && /서/.test(text) && !/낮|떠|주먹|손|발/.test(explained)) return [stand(), stand()];
  return [stand(), ...poses, stand()];
}

export function timelineFromPoses(frames: Frame[], value: unknown, focus: number | null) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 6) throw new Error("동작 자세는 2개에서 6개여야 합니다.");
  const base = stand();
  const poses = value.map((item) => fitAnalyzed(overlayPose(base, item)));
  const moved = poses.some((pose) => bodyIds.some((id) => Math.hypot(pose[id].x - base[id].x, pose[id].y - base[id].y) > 0.03));
  if (!moved) throw new Error("문장을 읽었지만 관절이 서기에서 벗어나지 않았습니다.");
  const focusPose = focus === null || !Number.isFinite(focus)
    ? Math.floor((poses.length - 1) / 2)
    : Math.max(0, Math.min(poses.length - 1, Math.round(focus)));
  const spread = spreadPoses(frames.length, poses, focusPose);
  return { ...spread, note: `문장을 읽어 ${poses.length}개 자세로 ${frames.length}칸을 채웠습니다.` };
}

function spreadPoses(count: number, poses: Pose[], focusPose: number) {
  const frames: Frame[] = Array.from({ length: count }, () => ({ pose: poses[0], key: false }));
  const slots = new Set<number>();
  let focus = 0;
  for (let i = 0; i < poses.length; i += 1) {
    let index = Math.round((i / Math.max(1, poses.length - 1)) * (count - 1));
    while (slots.has(index) && index < count - 1) index += 1;
    slots.add(index);
    frames[index] = { pose: poses[i], key: true };
    if (i === focusPose) focus = index;
  }
  if (!frames[0].key) frames[0] = { pose: poses[0], key: true };
  if (!frames[count - 1].key) frames[count - 1] = { pose: poses[poses.length - 1], key: true };
  return { frames: recompute(frames), focus };
}

function overlayPose(base: Pose, value: unknown): Pose {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("관절 JSON의 각 칸은 객체여야 합니다.");
  const record = value as Record<string, unknown>;
  const next = copyBody(base);
  const named = new Set<BodyId>();
  for (const id of bodyIds) {
    const raw = record[id];
    if (raw === undefined) continue;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${id} 좌표가 없습니다.`);
    const point = raw as { x?: unknown; y?: unknown };
    if (typeof point.x !== "number" || typeof point.y !== "number" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error(`${id} 좌표는 숫자여야 합니다.`);
    }
    next[id] = clampPoint({ x: point.x, y: point.y });
    named.add(id);
  }
  if (named.size === 0) throw new Error("아는 관절 이름이 JSON에 없습니다.");
  const follow: [BodyId, BodyId][] = [["rWrist", "rHand"], ["lWrist", "lHand"], ["rAnkle", "rToe"], ["lAnkle", "lToe"]];
  for (const [joint, tip] of follow) {
    if (!named.has(joint) || named.has(tip)) continue;
    next[tip] = clampPoint({
      x: base[tip].x + next[joint].x - base[joint].x,
      y: base[tip].y + next[joint].y - base[joint].y,
    });
  }
  return withFace(next);
}

function posesFromArray(text: string, base: Pose): Pose[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("관절 JSON 형식이 올바르지 않습니다.");
  }
  if (!Array.isArray(data) || data.length === 0) throw new Error("관절 JSON 배열에 자세가 없습니다.");
  return data.map((item) => overlayPose(base, item));
}

export function timelineFromPrompt(frames: Frame[], text: string) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("자세 문장이나 관절 JSON을 입력하세요.");
  if (trimmed.startsWith("[")) {
    const poses = posesFromArray(trimmed, frames[0].pose);
    const spread = spreadPoses(frames.length, poses, Math.floor((poses.length - 1) / 2));
    return { ...spread, note: `${poses.length}개 자세를 ${frames.length}칸 전체에 나눠 넣었습니다.` };
  }
  if (promptReadsMotion(trimmed)) {
    const sequence = posesFromSentence(trimmed);
    const spread = spreadPoses(frames.length, sequence, Math.max(0, sequence.length - 2));
    return { ...spread, note: `문장을 몸의 순서로 풀어 ${frames.length}칸에 넣었습니다.` };
  }
  let moved = 0;
  let keys = 0;
  const nudged = frames.map((frame, index) => {
    const isKey = frame.key || index === 0 || index === frames.length - 1;
    if (!isKey) return frame;
    const result = poseFromPrompt(frame.pose, trimmed);
    moved = Math.max(moved, result.moved);
    keys += 1;
    return { ...frame, pose: result.pose, key: true, image: undefined };
  });
  const note = moved === 0
    ? "이미 그 자리에 가깝습니다."
    : `${keys}개 키 칸에서 관절을 ${POSE_STEP} 이내로 옮겼습니다.`;
  return { frames: recompute(nudged), focus: null as number | null, note };
}
