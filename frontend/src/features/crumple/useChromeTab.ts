import { useEffect, useRef, useState } from "react";

interface Response { ok: boolean; title?: string; screenshot?: string | null; error?: string }
interface Runtime { sendMessage: (id: string, message: unknown, callback: (response?: Response) => void) => void; lastError?: { message?: string } }
const runtime = () => (window as unknown as { chrome?: { runtime?: Runtime } }).chrome?.runtime;

export function useChromeTab(hit: boolean) {
  const params = new URLSearchParams(window.location.search);
  const extension = params.get("extension"), token = params.get("session");
  const connected = !!extension && !!token;
  const [tab, setTab] = useState<{ title: string; screenshot: string | null } | null>(null);
  const [message, setMessage] = useState(connected ? "선택한 탭에 연결 중…" : "");
  const sent = useRef(false);
  const send = (type: string) => new Promise<Response>((resolve, reject) => {
    const api = runtime();
    if (!api || !extension || !token) { reject(new Error("크롬 확장 프로그램을 설치하고 탭을 선택해 주세요")); return; }
    api.sendMessage(extension, { type, token }, response => {
      const error = api.lastError;
      if (error || !response?.ok) reject(new Error(response?.error || error?.message || "확장 프로그램 연결 실패"));
      else resolve(response);
    });
  });
  useEffect(() => {
    if (!connected) return;
    let active = true;
    void send("LOAD").then(r => {
      if (active) { setTab({ title: r.title || "선택한 탭", screenshot: r.screenshot || null }); setMessage("골인하면 선택한 탭 하나만 닫힙니다"); }
    }, e => { if (active) setMessage(e.message); });
    return () => { active = false; };
  }, [extension, token]);
  useEffect(() => {
    if (!connected || !tab || !hit || sent.current) return;
    sent.current = true;
    void send("CLOSE").then(() => setMessage("선택한 탭을 닫았습니다"), e => setMessage(`탭을 닫지 못했습니다: ${e.message}`));
  }, [hit, tab, extension, token]);
  return { connected, tab, message };
}
