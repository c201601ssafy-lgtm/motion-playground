import { useEffect, useState } from "react";
import { LATENCY_STAGES, latency, STAGE_LABEL, type StageStats } from "./latency";

const fmt = (v: number | null) => (v === null ? "-" : v < 10 ? v.toFixed(1) : v.toFixed(0));

export function LatencyPanel() {
  const [stats, setStats] = useState<Record<string, StageStats>>(latency.stats());
  useEffect(() => {
    const id = setInterval(() => setStats(latency.stats()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <table data-testid="latency" style={{ fontSize: 11, color: "#8b949e", borderSpacing: "6px 0" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left" }}>지연(ms)</th>
          <th>p50</th>
          <th>p95</th>
          <th>n</th>
        </tr>
      </thead>
      <tbody>
        {LATENCY_STAGES.map((s) => (
          <tr key={s} data-stage={s}>
            <td>{STAGE_LABEL[s]}</td>
            <td>{fmt(stats[s]!.p50)}</td>
            <td>{fmt(stats[s]!.p95)}</td>
            <td>{stats[s]!.n}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
