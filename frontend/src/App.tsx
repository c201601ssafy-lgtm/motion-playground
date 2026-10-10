import { useEffect, useState } from "react";
import { getHealth } from "./services/api";

export default function App() {
  const [status, setStatus] = useState("확인 중…");

  useEffect(() => {
    getHealth()
      .then((h) => setStatus(h.status))
      .catch(() => setStatus("백엔드 연결 실패"));
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>HoloForge AI Lab</h1>
      <p>백엔드 상태: {status}</p>
    </main>
  );
}
