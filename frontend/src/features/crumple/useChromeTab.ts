import { useEffect, useRef, useState } from "react";

interface Response { ok: boolean; title?: string; screenshot?: string | null; error?: string; choices?: { id: number; title: string }[] }
interface Runtime { sendMessage: (id: string, message: unknown, callback: (response?: Response) => void) => void; lastError?: { message?: string } }
const runtime = () => (window as unknown as { chrome?: { runtime?: Runtime } }).chrome?.runtime;

export function useChromeTab(hit: boolean) {
  const params = new URLSearchParams(window.location.search);
  const extension = params.get("extension"), token = params.get("session");
  const connected = !!extension && !!token;
  const [tab, setTab] = useState<{ title: string; screenshot: string | null } | null>(null);
  const [message, setMessage] = useState(connected ? "선택한 탭에 연결 중…" : "");
  const sent = useRef(false);
  const [choices, setChoices] = useState<{ id: number; title: string }[]>([]);
  const [choosing, setChoosing] = useState(connected);
  const [busy, setBusy] = useState(false);
  const send = (type: string, tabId?: number) => new Promise<Response>((resolve, reject) => {
    const api = runtime();
    if (!api || !extension || !token) { reject(new Error("크롬 확장 프로그램을 설치하고 탭을 선택해 주세요")); return; }
    api.sendMessage(extension, { type, token, tabId }, response => {
      const error = api.lastError;
      if (error || !response?.ok) reject(new Error(response?.error || error?.message || "확장 프로그램 연결 실패"));
      else resolve(response);
    });
  });
  useEffect(() => {
    if (!connected) return;
    let active = true;
    void send("LOAD").then(r => {
      if (active) { setTab({ title: r.title || "선택한 탭", screenshot: r.screenshot || null }); setChoices(r.choices || []); setMessage("검지로 탭 카드를 가리키고 집어서 선택하세요"); }
    }, e => { if (active) setMessage(e.message); });
    return () => { active = false; };
  }, [extension, token]);
  const select = async (id: number) => {
    if (busy || sent.current) return;
    setBusy(true);
    try {
      const r = await send("SELECT", id);
      setTab({ title: r.title || "선택한 탭", screenshot: r.screenshot || null });
      setChoosing(false); setMessage("골인하면 선택한 탭 하나만 닫힙니다");
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!connected || !tab || choosing || !hit || sent.current) return;
    sent.current = true;
    void send("CLOSE").then(() => setMessage("선택한 탭을 닫았습니다"), e => setMessage(`탭을 닫지 못했습니다: ${e.message}`));
  }, [hit, tab, extension, token, choosing]);
  return { connected, tab, message, choices, choosing, busy, select, chooseAgain: () => { if (!sent.current) setChoosing(true); } };
}
