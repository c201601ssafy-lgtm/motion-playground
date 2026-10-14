import { buildHandFrame } from "../gestures/features";
import { POSES, syntheticHand, type HandPose } from "../gestures/synthetic";
import type { HandFrame } from "../hand-tracking/types";
import type { Game } from "./motions";
import type { PoseFrame } from "./poseTracking";

export function demoFrames(game: Game, now: number, side: "left" | "right") {
  const t = now / 1000, cycle = t % 4;
  const make = (label: "left" | "right", pose: HandPose = POSES.FIST, x = 0.5, y = 0.7): HandFrame =>
    buildHandFrame(syntheticHand(pose, { wrist: { x, y }, scale: 0.12 }), label, 0.99, now, 4 / 3);
  let hands: HandFrame[];
  if (game === "running") {
    const phase = Math.floor(t * 3) % 4;
    const pose = { ...POSES.OPEN_PALM, index: phase === 0 ? "curled" : "extended", middle: phase === 2 ? "curled" : "extended" } as const;
    hands = [make(side, pose)];
  } else if (game === "racing") {
    const dy = Math.tan(Math.sin(t) * 25 * Math.PI / 180) * 0.4 * 4 / 3;
    const pose = cycle > 2.7 ? POSES.OPEN_PALM : POSES.FIST;
    hands = [make("left", pose, 0.7, 0.5 - dy / 2), make("right", pose, 0.3, 0.5 + dy / 2)];
  } else hands = [make(side, cycle > 3 ? POSES.OPEN_PALM : POSES.FIST)];
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  points[11] = { x: 0.4, y: 0.35, z: 0, visibility: 1 }; points[12] = { x: 0.6, y: 0.35, z: 0, visibility: 1 };
  points[23] = { x: 0.43, y: 0.75, z: 0, visibility: 1 }; points[24] = { x: 0.57, y: 0.75, z: 0, visibility: 1 };
  for (const id of [11, 12]) {
    const sh = points[id]!;
    const angle = game === "pot" ? Math.sin(t * 2) * 1.3 : Math.sin(t) * 0.25;
    points[id + 4] = { ...sh, x: sh.x - Math.cos(angle) * 0.28, y: sh.y + Math.sin(angle) * 0.28 * 4 / 3 };
    points[id + 2] = { ...sh, x: (sh.x + points[id + 4]!.x) / 2, y: (sh.y + points[id + 4]!.y) / 2 + 0.07 };
  }
  if (game === "archery") {
    const drawId = side === "right" ? 16 : 15, bowId = side === "right" ? 15 : 16;
    const pull = Math.min(cycle / 2.8, 1);
    points[drawId] = { x: 0.25 + pull * 0.5, y: 0.4, z: 0, visibility: 1 };
    points[bowId] = { x: 0.15, y: 0.4 + Math.sin(t) * 0.06, z: 0, visibility: 1 };
  }
  return { hands, pose: { points, at: now, demo: true } as PoseFrame };
}
