import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { handFrameBus } from "../hand-tracking/frameBus";
import { CrumpleGesture, crumpledVertex } from "./crumpleGesture";
import styles from "./CrumpleDemo.module.css";
import { swipeShot, type SwipePoint } from "./swipeThrow";
import { useChromeTab } from "./useChromeTab";
import { BIN, basketballShot, flightPoint, PaperThrow, type ThrowState } from "./paperThrow";

function browserTexture(title?: string) {
  const canvas = document.createElement("canvas"); canvas.width = 1100; canvas.height = 720;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#ffffff"; c.fillRect(0, 0, 1100, 720);
  c.fillStyle = "#e8edf5"; c.fillRect(0, 0, 1100, 50);
  c.fillStyle = "#ffffff"; c.fillRect(45, 12, 285, 39);
  c.fillStyle = "#334155"; c.font = "19px sans-serif"; c.fillText(`${(title || "Motion Playground").slice(0, 27)}   ×`, 75, 38);
  c.fillText("+", 355, 35); c.fillText("—     □     ×", 960, 34);
  c.fillStyle = "#f8fafc"; c.fillRect(0, 50, 1100, 65);
  c.fillStyle = "#64748b"; c.font = "25px sans-serif"; c.fillText("‹   ›   ⟳", 22, 91);
  c.fillStyle = "#edf2f7"; c.beginPath(); c.roundRect(145, 63, 830, 39, 22); c.fill();
  c.fillStyle = "#475569"; c.font = "18px sans-serif"; c.fillText("⌕    chrome://motion-demo", 165, 90);
  c.font = "bold 76px sans-serif";
  const letters = [["G", "#4285f4"], ["o", "#ea4335"], ["o", "#fbbc05"], ["g", "#4285f4"], ["l", "#34a853"], ["e", "#ea4335"]];
  let x = 412; for (const [letter, color] of letters) { c.fillStyle = color!; c.fillText(letter!, x, 278); x += c.measureText(letter!).width; }
  c.strokeStyle = "#dbe2ec"; c.lineWidth = 2; c.beginPath(); c.roundRect(265, 318, 570, 54, 28); c.stroke();
  c.fillStyle = "#94a3b8"; c.font = "20px sans-serif"; c.fillText("Search, explore, then crumple away…", 305, 353);
  for (let i = 0; i < 4; i++) {
    const cx = 340 + i * 140;
    c.fillStyle = ["#eff6ff", "#fef3c7", "#fce7f3", "#dcfce7"][i]!;
    c.beginPath(); c.arc(cx, 445, 30, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#64748b"; c.font = "20px sans-serif"; c.fillText(["✦", "♫", "⌘", "+"][i]!, cx - 9, 452);
    c.font = "16px sans-serif"; c.fillText(["Explore", "Music", "Projects", "Add"][i]!, cx - 25, 500);
  }
  c.fillStyle = "#94a3b8"; c.font = "17px sans-serif"; c.fillText("A browser window you can hold like paper.", 375, 622);
  if (title) {
    c.fillStyle = "#f8fafc"; c.fillRect(0, 115, 1100, 605);
    c.fillStyle = "#334155"; c.textAlign = "center"; c.font = "bold 34px sans-serif";
    c.fillText(title.slice(0, 38), 550, 340);
    c.fillStyle = "#64748b"; c.font = "24px sans-serif";
    c.fillText("선택한 크롬 탭", 550, 410); c.textAlign = "left";
  }
  // Warm paper stock and subtle fibers, while retaining the browser print.
  c.fillStyle = "rgba(242, 232, 210, 0.12)"; c.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function paperGrain() {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!, data = ctx.createImageData(128, 128);
  let seed = 37;
  for (let i = 0; i < data.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    const tone = 128 + Math.round((seed / 2147483647 - 0.5) * 36);
    data.data[i] = data.data[i + 1] = data.data[i + 2] = tone; data.data[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(6, 6);
  return texture;
}

function PaperWindow({ progress, toss, onGrab, tab }: { progress: number; toss: ThrowState; onGrab: (event: PointerEvent) => void; tab: { title: string; screenshot: string | null } | null }) {
  const mesh = useRef<THREE.Group>(null), displayed = useRef(0);
  const texture = useMemo(() => browserTexture(tab?.title), [tab?.title]);
  useEffect(() => {
    if (!tab?.screenshot) return;
    const image = new Image();
    image.onload = () => {
      const canvas = texture.image as HTMLCanvasElement, ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 115, canvas.width, canvas.height - 115);
      const scale = Math.min(canvas.width / image.width, (canvas.height - 115) / image.height);
      ctx.drawImage(image, (canvas.width - image.width * scale) / 2, 115 + (canvas.height - 115 - image.height * scale) / 2, image.width * scale, image.height * scale);
      texture.needsUpdate = true;
    };
    image.src = tab.screenshot;
    return () => { image.onload = null; };
  }, [tab?.screenshot, texture]);
  const grain = useMemo(paperGrain, []);
  const geometry = useMemo(() => {
    const sheet = new THREE.PlaneGeometry(5.5, 3.6, 26, 18);
    const facets = sheet.toNonIndexed(); sheet.dispose(); return facets;
  }, []);
  const initial = useMemo(() => Float32Array.from(geometry.attributes.position!.array), [geometry]);
  useEffect(() => () => { texture.dispose(); grain.dispose(); geometry.dispose(); }, [texture, grain, geometry]);
  useFrame((_state, dt) => {
    const t = displayed.current += (progress - displayed.current) * (1 - Math.exp(-dt * 8));
    const fold = Math.min(1, t / 0.88);
    const vertices = geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < vertices.count; i++) {
      const p = crumpledVertex(initial[i * 3]!, initial[i * 3 + 1]!, fold);
      vertices.setXYZ(i, ...p);
    }
    vertices.needsUpdate = true; geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    if (mesh.current) {
      mesh.current.rotation.set(t * 0.35, t * 0.7, t * -0.6);
      mesh.current.visible = toss.phase !== "hit";
      if (toss.phase === "missed") mesh.current.position.set(...toss.position);
      mesh.current.position.lerp(new THREE.Vector3(...toss.position), 1 - Math.exp(-dt * (toss.phase === "flying" ? 35 : 12)));
      if (toss.phase === "flying") mesh.current.rotation.set(_state.clock.elapsedTime * 4, _state.clock.elapsedTime * 6, t * -0.6);
    }
  });
  return <group ref={mesh}>
    {toss.phase === "holding" && <mesh onPointerDown={(e) => { e.stopPropagation(); onGrab(e.nativeEvent); }}><sphereGeometry args={[0.6, 12, 8]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} /></mesh>}
    <mesh geometry={geometry} castShadow receiveShadow frustumCulled={false}><meshStandardMaterial map={texture} bumpMap={grain} bumpScale={0.012} side={THREE.FrontSide} flatShading roughness={1} metalness={0} /></mesh>
    <mesh geometry={geometry} castShadow receiveShadow frustumCulled={false}><meshStandardMaterial color="#f4f0e6" bumpMap={grain} bumpScale={0.012} side={THREE.BackSide} flatShading roughness={1} metalness={0} /></mesh>
  </group>;
}

function WasteBasket({ hit }: { hit: boolean }) {
  return <group position={[BIN.x, BIN.y - 0.55, BIN.z]}>
    <mesh><cylinderGeometry args={[BIN.radius, 0.47, 1.1, 20, 5, true]} /><meshStandardMaterial color={hit ? "#4ade80" : "#789bbd"} transparent opacity={0.25} side={THREE.DoubleSide} /></mesh>
    <mesh><cylinderGeometry args={[BIN.radius, 0.47, 1.1, 16, 5, true]} /><meshBasicMaterial color={hit ? "#4ade80" : "#87a8c9"} wireframe transparent opacity={0.55} /></mesh>
    <mesh position={[0, 0.55, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[BIN.radius, 0.035, 8, 36]} /><meshStandardMaterial color={hit ? "#4ade80" : "#b6cee8"} metalness={0.4} roughness={0.35} /></mesh>
    <mesh position={[0, -0.55, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.47, 24]} /><meshStandardMaterial color="#31455e" side={THREE.DoubleSide} /></mesh>
  </group>;
}

function CourtCamera({ playing }: { playing: boolean }) {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3());
  useFrame((_s, dt) => {
    const a = 1 - Math.exp(-dt * 5);
    camera.position.lerp(new THREE.Vector3(0, playing ? 2.5 : 0, playing ? 7.2 : 6.2), a);
    target.current.lerp(new THREE.Vector3(0, 0, playing ? -2.8 : 0), a);
    camera.lookAt(target.current);
  });
  return null;
}

function MiniCourt() {
  const floor = BIN.y - 1.1;
  return <group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, floor, -3]}><planeGeometry args={[14, 14]} /><meshStandardMaterial color="#142c43" roughness={1} /></mesh>
    <gridHelper args={[14, 14, "#335b79", "#203f5b"]} position={[0, floor + 0.008, -3]} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, floor + 0.015, 0.2]}><planeGeometry args={[3.2, 0.035]} /><meshBasicMaterial color="#60a5fa" /></mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[BIN.x, floor + 0.02, BIN.z]}><ringGeometry args={[1, 1.03, 48]} /><meshBasicMaterial color="#647f99" /></mesh>
    <mesh position={[BIN.x, BIN.y + 0.7, BIN.z - 0.7]}><boxGeometry args={[1.8, 1.2, 0.06]} /><meshStandardMaterial color="#1e405d" /></mesh>
    <mesh position={[BIN.x, BIN.y + 0.7, BIN.z - 0.66]}><boxGeometry args={[0.6, 0.45, 0.015]} /><meshBasicMaterial color="#60a5fa" wireframe /></mesh>
  </group>;
}

function Trajectory({ toss }: { toss: ThrowState }) {
  const line = useMemo(() => {
    const points = Array.from({ length: 42 }, (_, i) => new THREE.Vector3(...flightPoint(toss.position, toss.velocity, i * 0.05)));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const object = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: "#fbbf24", dashSize: 0.14, gapSize: 0.08, transparent: true, opacity: 0.9 }));
    object.computeLineDistances(); return object;
  }, [toss.position, toss.velocity]);
  useEffect(() => () => { line.geometry.dispose(); (line.material as THREE.Material).dispose(); }, [line]);
  return toss.phase === "holding" && Math.hypot(toss.velocity[0], toss.velocity[1]) > 0.5 ? <primitive object={line} /> : null;
}

export function CrumpleDemo() {
  const controller = useRef(new CrumpleGesture()), progress = useRef(0), auto = useRef<number | null>(null), held = useRef(false);
  const [state, setState] = useState({ progress: 0, closed: false, armed: false, message: "두 손을 펼쳐 창 양쪽을 잡듯 벌려 주세요" });
  const [manual, setManual] = useState(false);
  const playArea = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ id: number; points: SwipePoint[]; origin: [number, number, number] } | null>(null);
  const point = (e: { clientX: number; clientY: number }) => {
    const r = playArea.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.height, y: (e.clientY - r.top) / r.height, at: performance.now() };
  };
  const grab = (e: PointerEvent) => {
    if (!manual || e.button !== 0 || throwController.current.state.phase !== "holding") return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    swipe.current = { id: e.pointerId, points: [point(e)], origin: [...throwController.current.state.position] };
  };
  const move = (e: { pointerId: number; clientX: number; clientY: number }) => {
    const drag = swipe.current;
    if (!drag || drag.id !== e.pointerId) return;
    const p = point(e); drag.points.push(p);
    const first = drag.points[0]!;
    const live = throwController.current.state;
    live.position = [drag.origin[0] + (p.x - first.x) * 5, drag.origin[1] + (first.y - p.y) * 5, 0];
    const shot = swipeShot(drag.points);
    live.velocity = shot ? basketballShot(live.position, shot.power, shot.aim) : [0, 0, 0];
    live.message = "위로 쓸어 올리고 놓으세요 · 점선은 예상 궤적입니다";
  };
  const cancelSwipe = () => {
    if (!swipe.current) return;
    swipe.current = null;
    throwController.current.state.position = [0, 0, 0];
    throwController.current.state.velocity = [0, 0, 0];
  };
  const release = (e: { pointerId: number; clientX: number; clientY: number }) => {
    if (swipe.current?.id !== e.pointerId) return;
    move(e);
    const shot = swipeShot(swipe.current.points);
    if (shot) { swipe.current = null; throwController.current.throwAtBin(performance.now(), shot.power, shot.aim); }
    else { cancelSwipe(); throwController.current.state.message = "종이뭉치를 잡고 위로 빠르게 쓸어 올린 뒤 놓으세요"; }
  };
  const throwController = useRef(new PaperThrow()), madeBall = useRef(false);
  const [toss, setToss] = useState<ThrowState>(() => throwController.current.step(performance.now()));
  const chromeTab = useChromeTab(toss.phase === "hit");
  useEffect(() => {
    const unsubscribe = handFrameBus.subscribe((_frame, timing, hands) => {
      if (manual || timing.demo) return;
      controller.current.observe(hands, performance.now());
      if (madeBall.current) throwController.current.observe(hands, performance.now());
    });
    let handle = 0, last = performance.now(), hud = 0;
    const tick = (now: number) => {
      const dt = Math.min(100, now - last); last = now;
      if (manual) {
        if (held.current) progress.current = Math.min(1, progress.current + dt / 1800);
        if (auto.current !== null) progress.current = Math.min(1, (now - auto.current) / 2100);
      } else progress.current = controller.current.tick(now).progress;
      if (progress.current >= 1 && !madeBall.current) { madeBall.current = true; throwController.current.begin(); if (manual) throwController.current.state.message = "종이뭉치를 클릭한 채 위로 쓸어 올리고 놓으세요"; auto.current = null; held.current = false; }
      if (madeBall.current) progress.current = 1;
      if (now - hud > 32) {
        const live = controller.current.tick(now);
        setState(manual ? { progress: progress.current, closed: progress.current >= 1, armed: true,
          message: progress.current >= 1 ? "크롬 창 모형이 구겨져 닫혔습니다" : "슬라이더를 움직이거나 구기기 버튼을 길게 눌러 보세요" } : live);
        hud = now;
        setToss(throwController.current.step(now));
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => { unsubscribe(); cancelAnimationFrame(handle); };
  }, [manual]);
  const reset = () => { swipe.current = null; controller.current = new CrumpleGesture(); throwController.current = new PaperThrow(); madeBall.current = false; setToss(throwController.current.step(performance.now())); progress.current = 0; auto.current = null; held.current = false; setState({ progress: 0, closed: false, armed: false, message: "창을 다시 펼쳤습니다. 두 손을 벌려 주세요" }); };
  return <section className={styles.scene} aria-label="크롬 창 구기기 데모">
    <div className={styles.heading}><span>PAPER BALL · FREE THROW</span><h2>구겨서, 멀리 있는 통으로 슛!</h2><p>{manual ? "종이뭉치를 잡고 위로 쓸어 올려 던져 보세요. 마우스 속도와 방향으로 슛을 조절합니다." : "한 손으로 종이뭉치를 잡고 위로 밀어 올리며 손을 펼쳐 보세요. 손의 속도가 슛의 힘이 됩니다."}</p></div>
    <div ref={playArea} className={styles.canvas} onPointerMove={move} onPointerUp={release} onPointerCancel={cancelSwipe} onLostPointerCapture={cancelSwipe}><Canvas camera={{ position: [0, 0, 6.2], fov: 40 }} dpr={[1, 1.5]}><CourtCamera playing={toss.phase !== "idle"} /><ambientLight intensity={0.8} /><directionalLight position={[3, 5, 6]} intensity={1.2} /><directionalLight position={[-3, -2, 2]} intensity={0.35} color="#b8d4ff" /><PaperWindow progress={state.progress} toss={toss} onGrab={grab} tab={chromeTab.tab} />{toss.phase !== "idle" && <><MiniCourt /><WasteBasket hit={toss.phase === "hit"} /><Trajectory toss={toss} /></>}</Canvas></div>
    {toss.phase === "hit" && <div className={styles.closed}><b>골인!</b><span>창 모형을 쓰레기통에 버렸습니다.</span></div>}
    <div className={styles.controls}>
      {chromeTab.connected && <div className={styles.instructions}><strong>선택한 탭: {chromeTab.tab?.title || "연결 중"}</strong><p role="status">{chromeTab.message}</p></div>}
      <div className={styles.mode}><button aria-pressed={!manual} onClick={() => { setManual(false); reset(); }}>카메라 모션</button><button aria-pressed={manual} onClick={() => { setManual(true); reset(); }}>마우스로 체험</button><button onClick={reset}>창 다시 펼치기</button></div>
      {manual && toss.phase === "idle" ? <div className={styles.manual}><label>구김 정도<input aria-label="구김 정도" type="range" min="0" max="1" step="0.01" value={state.progress} onChange={(e) => { auto.current = null; const p = Number(e.target.value); progress.current = p; setState((s) => ({ ...s, progress: p, closed: p >= 1 })); }} /></label><button onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); held.current = true; auto.current = null; }} onPointerUp={() => { held.current = false; }} onPointerCancel={() => { held.current = false; }}>꾹 눌러 구기기</button><button onClick={() => { progress.current = 0; auto.current = performance.now(); }}>전체 효과 재생</button></div> : <p className={styles.instructions}>{toss.phase === "idle" ? "① 카메라 켜기 → ② 양손 펼쳐 벌리기 → ③ 손가락을 오므리며 모으기" : manual ? "종이뭉치를 잡고 위로 쓸어 올려 던지세요" : "④ 한 손으로 잡고 조준 → ⑤ 위로 밀어 올리며 손가락을 펼쳐 슛 · 빨리 올리면 더 멀리"}</p>}
      {manual && toss.phase === "holding" && <p className={styles.instructions}>종이뭉치를 잡고 위로 쓸어 올린 뒤 놓으세요 · 빠를수록 멀리, 좌우 움직임으로 방향 조절</p>}
      {toss.phase === "missed" && <div className={styles.manual}><button onClick={() => { throwController.current.begin(); if (manual) throwController.current.state.message = "종이뭉치를 클릭한 채 위로 쓸어 올리고 놓으세요"; }}>종이뭉치 다시 줍기</button></div>}
      <div className={styles.status}><span role="status">{toss.phase === "idle" ? state.message : toss.message}</span><b>{toss.phase === "idle" ? `${Math.round(state.progress * 100)}%` : toss.phase === "holding" ? "던지기 준비" : toss.phase === "flying" ? "비행 중" : toss.phase === "hit" ? "골인" : "다시 시도"}</b></div><div className={styles.track}><i style={{ width: `${state.progress * 100}%` }} /></div>
      <small>{chromeTab.connected ? "확장 프로그램에서 선택한 탭만 골인 후 닫습니다. 체험 페이지는 유지됩니다." : "시각 효과를 확인하는 데모입니다. 실제 크롬 탭이나 창은 닫히지 않습니다."}</small>
    </div>
  </section>;
}
