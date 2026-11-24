import { facingAt, poseAt, type Frame } from "./pose";
import { MOTION_MAKE_FRAMES, MOTION_MAKE_SECONDS } from "./methods";

export const ACTOR_FRAMES = MOTION_MAKE_FRAMES;
export const ACTOR_SECONDS = MOTION_MAKE_SECONDS;

export function actorPoses(frames: Frame[]) {
  return Array.from({ length: ACTOR_FRAMES }, (_, index) => {
    const t = index / (ACTOR_FRAMES - 1);
    return { pose: poseAt(frames, t), facing: facingAt(frames, t) };
  });
}
