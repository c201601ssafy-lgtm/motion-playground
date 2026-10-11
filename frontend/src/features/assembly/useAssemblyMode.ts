import { useEffect } from "react";
import { ApiError } from "../../services/api";
import * as api from "../../services/assemblyApi";
import { useAssemblyStore } from "../../store/assemblyStore";
import { type DropEvent, type PartPose, useLabStore } from "../../store/labStore";
import type { AssemblySnapshot } from "../../types/assembly";
import type { MechanismModel } from "../../types/model";
import { commandBus } from "../commands/commandBus";
import { poseAfterAttempt, resultToast, workbenchPose } from "./assemblyLogic";
import { loadRapier } from "./fallEffect";

/** 조립 모드 시작 시점 (작업대와 조립 영역이 모두 보이는 각도) */
const ASSEMBLY_VIEW = { yaw: 0, pitch: 0.5 };

const placedParts = (snap: AssemblySnapshot | null) => new Set(Object.values(snap?.placed ?? {}));

/** 조립되지 않은 부품은 작업대(또는 지금 놓인 자리)에, 조립된 부품은 슬롯에 둔다. */
function layout(model: MechanismModel, snap: AssemblySnapshot | null, keepCurrent: boolean) {
  const lab = useLabStore.getState();
  const placed = placedParts(snap);
  const poses: Record<string, PartPose> = {};
  for (const p of model.parts) {
    if (placed.has(p.part_id)) continue;
    poses[p.part_id] = (keepCurrent && lab.poses[p.part_id]) || workbenchPose(model, p.part_id);
  }
  lab.setPoses(poses);
  lab.setLockedParts([...placed]);
}

function errorText(err: unknown): string {
  if (err instanceof ApiError && err.status === 0) return "백엔드에 연결할 수 없습니다. 백엔드를 켜 주세요.";
  return err instanceof Error ? err.message : String(err);
}

export async function startNewSession() {
  const model = useLabStore.getState().model;
  const asm = useAssemblyStore.getState();
  if (!model) return;
  asm.set({ busy: true, error: null, toast: null });
  try {
    const s = await api.createSession(model.meta.model_id);
    asm.set({
      sessionId: s.session_id,
      snapshot: s.snapshot,
      lastResult: null,
      attempts: 0,
      errors: 0,
      startedAt: null,
      completedAt: null,
    });
    layout(model, s.snapshot, false);
  } catch (err) {
    asm.set({ error: errorText(err) });
  } finally {
    useAssemblyStore.getState().set({ busy: false });
  }
}

async function ensureSession(model: MechanismModel) {
  const asm = useAssemblyStore.getState();
  if (asm.sessionId) {
    try {
      const s = await api.getSession(asm.sessionId);
      asm.set({ snapshot: s.snapshot, error: null });
      layout(model, s.snapshot, true);
      return;
    } catch {
      // 세션이 사라졌으면 새로 만든다
    }
  }
  await startNewSession();
}

async function onDrop(e: DropEvent) {
  const model = useLabStore.getState().model;
  const asm = useAssemblyStore.getState();
  if (!model || !asm.sessionId) return;
  asm.set({ busy: true });
  try {
    const { result, snapshot } = await api.attemptPlace(asm.sessionId, {
      part_id: e.partId,
      position: e.pose.position,
      axis: [0, 1, 0],
      yaw_deg: ((e.pose.yaw % 360) + 360) % 360,
    });
    const lab = useLabStore.getState();
    const next = poseAfterAttempt(model, result, e.pose);
    // 규칙 위반으로 작업대로 돌아가는 경우: 튕겨 떨어지는 연출 뒤에 돌아간다 (판정과 무관한 연출)
    if (next && result.error_type !== "TOO_FAR") lab.triggerFall(e.partId, next.position[1]);
    if (next) lab.setPose(e.partId, next);
    else lab.clearPose(e.partId);
    lab.setLockedParts([...placedParts(snapshot)]);
    const now = performance.now();
    const cur = useAssemblyStore.getState();
    const counted = result.error_type !== "TOO_FAR";
    cur.set({
      snapshot,
      lastResult: result,
      toast: resultToast(result),
      attempts: cur.attempts + (counted ? 1 : 0),
      errors: cur.errors + (counted && !result.is_valid ? 1 : 0),
      startedAt: cur.startedAt ?? now,
      completedAt: snapshot.is_complete ? (cur.completedAt ?? now) : null,
      error: null,
    });
  } catch (err) {
    useLabStore.getState().setPose(e.partId, workbenchPose(model, e.partId));
    useAssemblyStore.getState().set({ error: errorText(err) });
  } finally {
    useAssemblyStore.getState().set({ busy: false });
  }
}

async function onResetStep() {
  const model = useLabStore.getState().model;
  const asm = useAssemblyStore.getState();
  if (!model || !asm.sessionId) return;
  try {
    const { removed, snapshot } = await api.resetStep(asm.sessionId);
    asm.set({
      snapshot,
      toast: { kind: "info", title: "단계 되돌림", message: removed.length ? `${removed.length}개 부품을 작업대로 돌렸습니다.` : "되돌릴 부품이 없습니다." },
    });
    layout(model, snapshot, true);
    for (const id of removed) useLabStore.getState().setPose(id, workbenchPose(model, id));
  } catch (err) {
    asm.set({ error: errorText(err) });
  }
}

async function onAssembleAll() {
  const model = useLabStore.getState().model;
  const asm = useAssemblyStore.getState();
  if (!model || !asm.sessionId) return;
  try {
    const snapshot = await api.assembleAll(asm.sessionId);
    asm.set({ snapshot, toast: { kind: "info", title: "자동 조립", message: "데모용으로 모든 부품을 조립했습니다." } });
    layout(model, snapshot, false);
  } catch (err) {
    asm.set({ error: errorText(err) });
  }
}

export function useAssemblyMode() {
  const mode = useLabStore((s) => s.mode);
  const model = useLabStore((s) => s.model);
  const offline = useLabStore((s) => s.offline);

  useEffect(() => {
    if (mode !== "assemble" || !model) return;
    const lab = useLabStore.getState();
    lab.setExploded(false);
    lab.setFocus(null);
    lab.setView(ASSEMBLY_VIEW.yaw, ASSEMBLY_VIEW.pitch);
    lab.setHiddenParts([]);
    if (offline) {
      layout(model, null, false);
      lab.setLockedParts([]);
      useAssemblyStore.getState().set({ error: "백엔드 없이 실행 중이라 조립 판정을 할 수 없습니다." });
    } else {
      void ensureSession(model);
      // 낙하 연출용 물리 엔진을 미리 받아 둔다. 실패해도 조립은 그대로 된다(연출만 생략).
      loadRapier().catch((err) => console.warn("[fall] Rapier 로드 실패, 낙하 연출 생략", err));
      lab.setOnDrop((e) => void onDrop(e));
    }
    const unsub = commandBus.subscribe(({ command }) => {
      if (command.type === "RESET_STEP") void onResetStep();
      else if (command.type === "ASSEMBLE_ALL") void onAssembleAll();
    });
    return () => {
      unsub();
      const l = useLabStore.getState();
      l.setOnDrop(null);
      l.setPoses({});
      l.setLockedParts([]);
      useAssemblyStore.getState().set({ toast: null });
    };
  }, [mode, model, offline]);
}
