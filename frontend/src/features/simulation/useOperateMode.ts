import { useEffect } from "react";
import * as api from "../../services/assemblyApi";
import { useAssemblyStore } from "../../store/assemblyStore";
import { useLabStore } from "../../store/labStore";
import { useOperateStore } from "../../store/operateStore";
import { spinsFromMechanism } from "./mechanismView";

const FETCH_DEBOUNCE_MS = 120;

/** 작동 모드: 조립된 부품만 보이고, 백엔드가 계산한 회전으로만 기어를 돌린다. */
export function useOperateMode() {
  const mode = useLabStore((s) => s.mode);
  const model = useLabStore((s) => s.model);
  const offline = useLabStore((s) => s.offline);
  const inputRpm = useOperateStore((s) => s.inputRpm);
  const sessionId = useAssemblyStore((s) => s.sessionId);
  const placedKey = useAssemblyStore((s) => JSON.stringify(s.snapshot?.placed ?? {}));

  // 모드 진입/이탈: 조립 상태대로 보여주기
  useEffect(() => {
    if (mode !== "operate" || !model) return;
    const lab = useLabStore.getState();
    lab.setExploded(false);
    lab.setFocus(null);
    lab.setPoses({});
    lab.setLockedParts(model.parts.map((p) => p.part_id));
    const placed = new Set(Object.values(JSON.parse(placedKey) as Record<string, string>));
    lab.setHiddenParts(sessionId ? model.parts.filter((p) => !placed.has(p.part_id)).map((p) => p.part_id) : []);
    return () => {
      const l = useLabStore.getState();
      l.setSpins({});
      l.setHiddenParts([]);
      l.setLockedParts([]);
    };
  }, [mode, model, sessionId, placedKey]);

  // rpm·조립 상태가 바뀌면 백엔드에 기구 상태를 묻는다
  useEffect(() => {
    if (mode !== "operate") return;
    const op = useOperateStore.getState();
    if (offline || !sessionId) {
      op.set({ mechanism: null, error: offline ? "백엔드 없이 실행 중이라 작동 계산을 할 수 없습니다." : null });
      useLabStore.getState().setSpins({});
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      op.set({ loading: true });
      api
        .getMechanism(sessionId, inputRpm)
        .then((m) => {
          if (cancelled) return;
          useOperateStore.getState().set({ mechanism: m, error: null });
          useLabStore.getState().setSpins(spinsFromMechanism(m));
        })
        .catch((err: unknown) => {
          if (!cancelled) useOperateStore.getState().set({ error: err instanceof Error ? err.message : String(err) });
        })
        .finally(() => {
          if (!cancelled) useOperateStore.getState().set({ loading: false });
        });
    }, FETCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [mode, offline, sessionId, inputRpm, placedKey]);
}
