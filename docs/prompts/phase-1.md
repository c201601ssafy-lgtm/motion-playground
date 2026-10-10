# Phase 1 — 뼈대 + 부품 데이터 + Assembly Engine + 마우스로 보는 3D

`docs/spec.md`와 `docs/decision-log.md`를 먼저 읽어라. decision-log가 spec보다 우선한다. 이번 단계 범위만 구현하고, 범위 밖은 TODO로 남겨라.

## 만들 것

1. **모노레포 뼈대** (spec §16 구조)
   - `frontend/`: Vite + React + TypeScript(strict) + React Three Fiber + drei + Zustand + Vitest. CSS Modules.
   - `backend/`: Python 3.12, FastAPI, Pydantic v2, PyYAML, pytest, Ruff. `pyproject.toml` (uv 또는 pip).
   - 루트 `README.md`(실행 방법), `.env.example`, `LICENSE`(MIT), `.gitignore`.
2. **부품 데이터** `models/gearbox/parts.yaml`, `connections.yaml`, `assembly-steps.yaml`
   - D-001의 8부품, D-005 스키마. 기어 모듈 0.05, 축 x = 0 / 0.9 / 2.4. `meshes_with`로 맞물림 표현.
   - `description`, `function`은 한국어 교육용 설명 1~2문장.
3. **백엔드**
   - `app/core/model_loader.py`: YAML → Pydantic 모델. 참조 무결성 검사(슬롯의 part_id/parent 존재, step 존재, 순환 없음, 맞물림 대칭, 기어 중심 거리 = (T1+T2)/2·m ± 1e-6).
   - `app/assembly/engine.py`: D-006 규칙 그대로. 순수 Python 클래스 `AssemblyEngine(model)` — `attempt(...)`, `mechanism_state(input_rpm)`, `reset_step()`, `state()`.
   - `app/api/`: `GET /api/health`, `GET /api/models/gearbox`, `POST /api/sessions`, `GET /api/sessions/{id}`, `POST /api/sessions/{id}/attempt`, `POST /api/sessions/{id}/reset-step`, `GET /api/sessions/{id}/mechanism`. 세션은 SQLite(stdlib `sqlite3`)에 JSON 상태 저장.
   - 테스트: 모든 오류 타입 각 1개 이상, 정상 전체 조립 시나리오, 기구 상태(출력 rpm = 입력/3, 아이들러 방향 반대). `evals/assembly-cases.jsonl`을 읽는 파라미터화 테스트 포함.
4. **프론트엔드 (웹캠 없이)**
   - `src/three/parts/`: 절차적 기어(톱니 Extrude), 축(Cylinder), 베이스/커버(Box). `PartVisual` 컴포넌트로 감싸 나중에 GLB 교체 가능하게.
   - `src/features/commands/`: D-004의 `Command` 타입, `CommandBus`(구독/발행), `MouseCommandSource`, `KeyboardCommandSource`(E=분해, A=전체 조립, R=단계 리셋, Esc=취소).
   - 씬은 Command만 구독한다. 마우스 이벤트를 씬에서 직접 처리하지 말 것.
   - 시작 시 `/api/models/gearbox`로 씬 생성. 조립 완료 상태로 표시 + 드래그로 모델 회전(ROTATE_MODEL)까지.
   - Vite dev proxy `/api` → `localhost:8000`.
5. **CI** `.github/workflows/ci.yml` (`permissions: contents: read`): ruff check, ruff format --check, pytest, `tsc --noEmit`, vitest, vite build. 모델 YAML 검증은 pytest에 포함.
6. **문서**: `docs/architecture.md`(파이프라인 텍스트 다이어그램), `docs/licenses.md`(패키지 버전·라이선스 표), `docs/simulation-limitations.md`(spec §11, §14 문구).

## 완료 조건

- `pytest`, `ruff`, `tsc`, `vitest`, `vite build` 전부 통과. 실제로 실행해서 결과 보여줘.
- 백엔드+프론트 실행 시 브라우저에서 기어박스 8부품이 보이고 마우스 드래그로 회전.
- 끝나면 바뀐 파일 목록, 실행 명령, Phase 2에서 이어받을 TODO 요약.
