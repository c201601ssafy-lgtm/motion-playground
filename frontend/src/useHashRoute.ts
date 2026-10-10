import { useEffect } from "react";
import { commandBus } from "./features/commands/commandBus";
import { modeHash, parseMode } from "./modes";
import { useLabStore } from "./store/labStore";

/** 해시 ↔ labStore.mode 동기화. SET_MODE 명령은 해시를 바꾼다. */
export function useModeRoute() {
  useEffect(() => {
    const sync = () => useLabStore.getState().setMode(parseMode(window.location.hash));
    sync();
    window.addEventListener("hashchange", sync);
    const unsub = commandBus.subscribe(({ command }) => {
      if (command.type === "SET_MODE") window.location.hash = modeHash(command.mode);
    });
    return () => {
      window.removeEventListener("hashchange", sync);
      unsub();
    };
  }, []);
  return useLabStore((s) => s.mode);
}
