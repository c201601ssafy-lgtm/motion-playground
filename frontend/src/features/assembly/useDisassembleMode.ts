import { useEffect } from "react";
import { useLabStore } from "../../store/labStore";
import { commandBus } from "../commands/commandBus";

/** 분해 모드: 들어오면 분해도, 나가면 원래대로. EXPLODE는 토글, ASSEMBLE_ALL은 접기. */
export function useDisassembleMode() {
  const mode = useLabStore((s) => s.mode);

  useEffect(() => {
    if (mode !== "disassemble" && mode !== "lab") return;
    const s = useLabStore.getState();
    s.setPoses({});
    s.setHiddenParts([]);
    s.setExploded(mode === "disassemble");
    if (mode === "lab") s.setFocus(null);
    return commandBus.subscribe(({ command }) => {
      const st = useLabStore.getState();
      if (command.type === "EXPLODE") st.setExploded(!st.exploded);
      else if (command.type === "ASSEMBLE_ALL") {
        st.setExploded(false);
        st.setPoses({});
      } else if (command.type === "CANCEL") st.setFocus(null);
    });
  }, [mode]);
}
