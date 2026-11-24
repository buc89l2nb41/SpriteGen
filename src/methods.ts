export type MethodId = "kling" | "pose" | "puppet";
export type KlingQuality = "standard" | "pro";

export type MethodInfo = {
  id: MethodId;
  label: string;
  hint: string;
  title: string;
  kind: "clip" | "motion";
  note: string;
};

export const methods: MethodInfo[] = [
  {
    id: "kling",
    label: "문장참고",
    hint: "문장으로 뽑기",
    title: "문장참고",
    kind: "clip",
    note: "기준 캐릭터 그림과 문장으로 Kling 3가 동작 영상을 만들고, 그 영상을 칸으로 자릅니다. 시작과 끝이 같은 동작이면 반복을 켜세요.",
  },
  {
    id: "pose",
    label: "포즈참고",
    hint: "OpenPose",
    title: "포즈참고",
    kind: "motion",
    note: "오른쪽에서 모델 위의 관절을 고쳐 만든 3D 몸 영상을 Kling Motion Control이 따라갑니다.",
  },
  {
    id: "puppet",
    label: "영상참고",
    hint: "참고 영상",
    title: "영상참고",
    kind: "motion",
    note: "동작 설명으로 그린 회색 인형 그림을 이어 참고 영상을 만들고, 그 영상을 Kling Motion Control이 따라갑니다. 직접 찍은 영상을 올려도 됩니다.",
  },
];

export const KLING_MODELS: Record<KlingQuality, string> = {
  standard: "fal-ai/kling-video/v3/standard/image-to-video",
  pro: "fal-ai/kling-video/v3/pro/image-to-video",
};

export const KLING_PRICES: Record<KlingQuality, string> = {
  standard: "3초 약 $0.25",
  pro: "3초 약 $0.34",
};

export const MOTION_MODEL = "fal-ai/kling-video/v3/standard/motion-control";
export const PUPPET_SECONDS = 5;
export const PUPPET_PRICE = "5초 약 $0.42";

const motionLabels: Record<string, string> = {
  idle: "대기",
  walk: "걷기",
  run: "달리기",
  attack: "공격",
  hurt: "피격",
  death: "사망",
  pose: "자세",
};

export function motionLabel(id: string) {
  return motionLabels[id] ?? id;
}

export const MOTION_MIN_SECONDS = 3;
export const MOTION_MAX_SECONDS = 10;
export const MOTION_FPS = 12;
export const MOTION_MAKE_SECONDS = 3.5;
export const MOTION_MAKE_FRAMES = MOTION_MAKE_SECONDS * MOTION_FPS;

const loops = new Set(["idle", "walk", "run"]);

export function methodById(id: string) {
  return methods.find((item) => item.id === id) ?? null;
}

export function clipUsesEnd(motion: string) {
  return loops.has(motion);
}

export function motionPrice(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "영상 1초당 $0.126";
  return `${seconds.toFixed(1)}초 × $0.126 ≈ $${(seconds * 0.126).toFixed(2)}`;
}
