import { useEffect, useRef, useState } from "react";
import { handFrameBus } from "../hand-tracking/frameBus";
import { toScreen } from "../gestures/gestureCommandSource";
import { TabSelectionGesture } from "./tabSelection";

export function CameraTabPicker({ choices, busy, onSelect }: { choices: { id: number; title: string }[]; busy: boolean; onSelect: (id: number) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const selection = useRef(onSelect);
  selection.current = onSelect;
  const [hovered, setHovered] = useState<number | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const gesture = new TabSelectionGesture();
    return handFrameBus.subscribe((_frame, timing, hands) => {
      if (timing.demo || busy) return;
      const hand = hands.find(h => h.handedness === "right" && h.confidence >= 0.6) ?? hands.find(h => h.confidence >= 0.6);
      const tip = hand?.landmarks[8];
      const screen = tip && Number.isFinite(tip.x) && Number.isFinite(tip.y) ? toScreen(tip) : null;
      const pointer = screen ? { x: screen.x * window.innerWidth, y: screen.y * window.innerHeight } : null;
      setCursor(pointer);
      const card = pointer ? document.elementFromPoint(pointer.x, pointer.y)?.closest<HTMLButtonElement>("[data-tab-id]") : null;
      const hit = card && root.current?.contains(card) ? Number(card.dataset.tabId) : null;
      const selected = gesture.observe(hand, hit, performance.now());
      setHovered(gesture.hovered);
      if (selected !== null) selection.current(selected);
    });
  }, [busy]);
  return <div ref={root} style={{ margin: "12px auto", maxWidth: 660, padding: "0 22px" }}>
    <p style={{ textAlign: "center", fontSize: 13 }}>① 카메라 켜기 → ② 검지만 펴서 탭 가리키기 → ③ 엄지·검지를 집어 선택</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, maxHeight: 260, overflow: "auto" }}>
      {choices.map(tab => <button key={tab.id} data-tab-id={tab.id} disabled={busy} onClick={() => onSelect(tab.id)} style={{ padding: "15px 12px", minHeight: 64, borderRadius: 12, border: `2px solid ${hovered === tab.id ? "#fbbf24" : "#365477"}`, background: hovered === tab.id ? "#314565" : "#182b43", color: "#e2e8f0", cursor: "pointer", textAlign: "left", overflowWrap: "anywhere" }}>{tab.title}</button>)}
    </div>
    <p style={{ textAlign: "center", fontSize: 12, color: "#94a3b8" }}>마우스로도 선택할 수 있습니다. 탭이 많으면 목록을 스크롤하세요.</p>
    {cursor && <div aria-hidden style={{ position: "fixed", left: cursor.x, top: cursor.y, width: 20, height: 20, borderRadius: "50%", border: "3px solid #fbbf24", transform: "translate(-50%, -50%)", pointerEvents: "none", zIndex: 100 }} />}
  </div>;
}
