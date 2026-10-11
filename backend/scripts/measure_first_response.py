"""서버 기동 직후 첫 튜터 질문 지연: 예열(OLLAMA_WARMUP) 끔 vs 켬 (P5-2, docs/experiments.md E-04).

매 회 qwen3:8b를 메모리에서 내리고 uvicorn을 새로 띄워 첫 질문·두 번째 질문 지연을 잰다.
실행: cd backend && uv run python scripts/measure_first_response.py [--runs 2]
"""

import argparse
import os
import subprocess
import sys
import tempfile
import time

import httpx

SCRATCH = tempfile.mkdtemp(prefix="holoforge-first-")
PORT = 8011
BASE = f"http://127.0.0.1:{PORT}"
Q = "작은 기어는 무슨 역할을 해?"


def loaded() -> bool:
    ps = httpx.get("http://localhost:11434/api/ps", timeout=5).json()
    return any(m["name"].startswith("qwen3:8b") for m in ps.get("models", []))


def run(warmup: bool, idx: int) -> dict:
    subprocess.run(["ollama", "stop", "qwen3:8b"], capture_output=True)
    while loaded():
        time.sleep(0.5)
    env = dict(
        os.environ,
        LLM_PROVIDER="ollama",
        OLLAMA_WARMUP="true" if warmup else "false",
        HOLOFORGE_DB_PATH=os.path.join(SCRATCH, f"m-{warmup}-{idx}.sqlite3"),
        PYTHONIOENCODING="utf-8",
    )
    with open(os.path.join(SCRATCH, f"uvicorn-{warmup}-{idx}.log"), "w", encoding="utf-8") as log:
        return _serve_and_ask(warmup, env, log)


def _serve_and_ask(warmup: bool, env: dict[str, str], log) -> dict:
    t_start = time.perf_counter()
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(PORT)],
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    try:
        while True:
            try:
                if httpx.get(f"{BASE}/api/health", timeout=1).status_code == 200:
                    break
            except httpx.HTTPError:
                time.sleep(0.2)
        t_ready = time.perf_counter() - t_start
        if warmup:  # 사용자가 화면을 여는 동안 예열이 끝난다고 가정: 모델이 올라올 때까지 대기
            while not loaded():
                time.sleep(0.5)
        t_loaded = time.perf_counter() - t_start
        sid = httpx.post(f"{BASE}/api/sessions", json={}).json()["session_id"]
        t0 = time.perf_counter()
        r = httpx.post(f"{BASE}/api/sessions/{sid}/tutor", json={"question": Q}, timeout=180).json()
        first = time.perf_counter() - t0
        t0 = time.perf_counter()
        httpx.post(f"{BASE}/api/sessions/{sid}/tutor", json={"question": Q}, timeout=180)
        second = time.perf_counter() - t0
        return {
            "warmup": warmup,
            "ready_s": round(t_ready, 1),
            "model_loaded_s": round(t_loaded, 1),
            "first_s": round(first, 1),
            "second_s": round(second, 1),
            "degraded": r.get("degraded"),
            "tools": [u["name"] for u in r.get("used_tools", [])],
        }
    finally:
        proc.terminate()
        proc.wait()


if __name__ == "__main__":
    # Windows 콘솔(cp949)에서도 한국어를 출력할 수 있게
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--runs", type=int, default=2)
    for i in range(ap.parse_args().runs):
        for w in (False, True):
            print(run(w, i), flush=True)
