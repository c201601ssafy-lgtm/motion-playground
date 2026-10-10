import { useEffect } from "react";
import { useLabStore } from "../../store/labStore";

/** 튜터 모드: 완성된 모델을 보여주고, 부품은 끌 수 없고 클릭으로 선택만 된다. */
export function useTutorMode() {
  const mode = useLabStore((s) => s.mode);
  const model = useLabStore((s) => s.model);
  useEffect(() => {
    if (mode !== "tutor" || !model) return;
    const lab = useLabStore.getState();
    lab.setExploded(false);
    lab.setPoses({});
    lab.setHiddenParts([]);
    lab.setLockedParts(model.parts.map((p) => p.part_id));
    return () => useLabStore.getState().setLockedParts([]);
  }, [mode, model]);
}
