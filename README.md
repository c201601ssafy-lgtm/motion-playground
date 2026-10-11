# HoloForge AI Lab

웹캠 손동작으로 3D 기어박스를 분해·조립하고, AI 튜터가 부품의 역할과 작동 원리를 설명하는 제스처 기반 공학 체험 서비스.

> 투명 디스플레이 사용 시 표현: "투명 디스플레이 또는 Pepper’s Ghost 방식의 홀로그램 유사 시각화". 실제 자유공간 홀로그램이 아니다.
> 교육용 시뮬레이션이며 실제 설계·제조·안전 판단에 사용할 수 없습니다.

## 화면

| 키 | 모드 | 내용 |
|---|---|---|
| 1 | 연구실 | 웹캠·손 추적 상태·현재 제스처, 펼친 손으로 모델 회전 |
| 2 | 분해 | 분해도, 부품 목록·설명, 조립 순서 |
| 3 | 조립 | 작업대 → 결합 지점, 슬롯 고스트, 규칙 엔진 판정, 오류 안내, 진행률 |
| 4 | 작동 | 입력 rpm, 기어별 회전 방향·속도비·rpm, 맞물림 지점 |
| 5 | AI 튜터 | 질문 → 도구 호출로 실제 상태 조회 → 설명 (도구 호출 내역 공개) |
| 6 | 실험 결과 | 지연 p50/p95, 조립 통계, 제스처·도구 호출 평가 |
| 7 | 데이터 녹화 | 손 랜드마크 2초 녹화 → JSONL (영상 저장 안 함) |

제스처: 🤏 집기 = 부품 잡기·이동·놓기 · ✋ 펼친 손 이동 = 모델 회전 · ✊ 주먹 = 취소.
마우스로도 똑같이 쓸 수 있다: 왼쪽 드래그로 이동, 잡은 채 휠이나 `[` `]`로 부품 회전, 빈 곳이나 오른쪽 드래그로 회전, `Esc`로 취소.

## 실행

요구: Node 20+, [uv](https://docs.astral.sh/uv/) (Python 3.12 자동 설치), 웹캠(선택), Chrome/Edge.

```bash
# 1) 백엔드
cd backend
uv sync
uv run uvicorn app.main:app --port 8000          # LLM_PROVIDER 기본값 mock

# 2) 프론트엔드 (다른 터미널)
cd frontend
npm install
npm run dev                                       # http://localhost:5173 (/api → localhost:8000)
```

### AI 튜터를 로컬 LLM으로 (선택)

```bash
ollama pull qwen3:8b                              # 약 5.2GB, VRAM 6~8GB 권장
cd backend
LLM_PROVIDER=ollama uv run uvicorn app.main:app --port 8000
# PowerShell: $env:LLM_PROVIDER="ollama"; uv run uvicorn app.main:app --port 8000
```

`LLM_PROVIDER=ollama`면 서버 시작 시 모델을 백그라운드로 미리 올리고(`OLLAMA_WARMUP`), `OLLAMA_KEEP_ALIVE`(기본 30m) 동안 메모리에 둔다.
Ollama가 꺼져 있거나 실패하면 규칙 기반 Mock으로 자동 폴백한다. 이때 화면에 "LLM 연결 실패 → 규칙 기반 답변"이 표시된다. 환경변수는 `.env.example`에 있다.

백엔드 포트를 바꾸면 프론트를 `HOLOFORGE_API_URL=http://localhost:8010 npm run dev`로 띄운다.
백엔드 없이 정적 배포(GitHub Pages)하면 3D 보기만 동작한다. 정적 모델 JSON으로 폴백하고, 조립 판정·작동·튜터는 백엔드가 필요하다.

## 검사

```bash
cd backend && uv run ruff check . && uv run ruff format --check . && uv run pytest
cd backend && uv run python scripts/eval_tool_calls.py --provider mock --min-selection 0.9
cd backend && uv run python scripts/eval_gestures.py          # datasets/gestures/raw/*.jsonl 없으면 합성 샘플
cd frontend && npm run typecheck && npm test && npm run build
```

데이터 재생성: `npm run gen:gesture-cases`, `npm run gen:gesture-samples` (frontend), `uv run python scripts/export_model.py`, `uv run python scripts/export_schemas.py` (backend). CI가 생성물과 원본이 같은지 검사한다.

## 완료 조건 (spec §22)

| # | 시나리오 | 검증 | 방법 |
|---|---|---|---|
| 1 | 카메라 권한 허용 | ✅ | Chrome 가짜 카메라: 허용 시 미리보기, 거부 시 안내 (스모크) · `camera.test.ts` |
| 2 | 손 감지 | ✅ | MediaPipe 샘플 손 사진 영상으로 95% 감지·오버레이 (스모크) |
| 3 | 현재 제스처 표시 | ✅ | 사진 → "손바닥 펼치기", 가상 손 4포즈 HUD (스모크) · `gestures.test.ts` |
| 4 | 집기로 부품 선택 | ✅ | 가상 손 집기 → 부품 잡힘 (스모크) · `gestureCommandSource.test.ts` |
| 5 | 손 이동으로 부품 이동 | ✅ | 가상 손 집기 이동 → 결합 성공 (스모크) |
| 6 | 손 움직임으로 모델 회전 | ✅ | 펼친 손 이동 → yaw 변화 (스모크) |
| 7 | 올바른 위치에서 조립 | ✅ | 마우스로 8부품 전체 조립 (스모크) · `test_assembly_engine.py` |
| 8 | 잘못된 위치에서 오류 표시 | ✅ | 순서·방향·자리 오류 토스트 (스모크) · `evals/assembly-cases.jsonl` 16건 |
| 9 | AI에게 부품 역할 질문 | ✅ | 튜터 화면 질문·예시·선택 부품 (스모크, 실제 qwen3) |
| 10 | AI가 실제 데이터 조회 후 설명 | ✅ | 도구 호출 내역 표시, qwen3 도구 선택률 94% · `test_tutor.py` |
| 11 | 작동 모드 회전 방향 확인 | ✅ | 아이들러 역회전·출력 1/3 (스모크) · `test_sessions_api.py` |
| 12 | 평가 스크립트로 정확도·지연 측정 | ✅ | `eval_gestures.py`, `eval_tool_calls.py`, 결과 화면 |

실제 웹캠과 사람 손으로 확인할 항목은 [docs/gesture-spec.md §9](docs/gesture-spec.md)의 체크리스트에 있다.

## 데모 시나리오 (5~10분)

| 시간 | 화면 | 진행 |
|---|---|---|
| 0:00 | 연구실(1) | "카메라 켜기" → 손을 올리면 랜드마크·제스처 표시. 펼친 손을 좌우로 움직여 기어박스 회전 |
| 1:00 | 분해(2) | 분해도로 펼쳐짐. 부품 목록에서 아이들러 기어 클릭 → 역할 설명, 나머지 흐리게 |
| 2:30 | 조립(3) | 작업대의 부품을 집기(🤏)로 옮김. 일부러 축을 베이스보다 먼저 놓아 **받침 부품 먼저** 오류 확인 |
| 3:30 | 조립(3) | 베이스를 90° 돌려 놓아 **방향 틀림**(기대 0°/현재 90°) 확인 → "왜 틀렸어?"로 튜터 설명 → 바로 놓아 1단계 완료 |
| 4:30 | 조립(3) | 출력축을 입력축 자리에 놓아 **다른 부품의 자리** 확인 → 축 3개·기어 3개·커버 조립 완료 |
| 6:00 | 작동(4) | 입력 30rpm → 아이들러는 반대(시계), 출력은 같은 방향 10rpm. 슬라이더로 -30rpm 반전 |
| 7:00 | AI 튜터(5) | "왜 이쪽으로 돌면 반대쪽 기어가 반대로 돌아?" → 도구 호출 내역과 함께 설명. "45rpm으로 돌려 봐" → 작동 화면 |
| 8:30 | 실험 결과(6) | 제스처 지연 p50/p95, 조립 시간·오류 횟수, 도구 호출 개선 전후 |

## 문서

- [구현 계획 / 진행 상태](docs/implementation-plan.md)
- [결정 기록](docs/decision-log.md) · [원본 명세](docs/spec.md)
- [아키텍처](docs/architecture.md) · [제스처 명세](docs/gesture-spec.md)
- [실험 기록](docs/experiments.md) · [모델 선택](docs/model-selection.md)
- [시뮬레이션 한계](docs/simulation-limitations.md) · [라이선스](docs/licenses.md)

## 남은 위험과 로드맵

| 항목 | 상태 | 다음 단계 |
|---|---|---|
| 실제 사람 제스처 데이터 | 없음 (합성만) | 7명 × 4라벨 × 조명 3 녹화 → 재평가, 사용자 단위 분리 |
| 학습 기반 분류기 | 미구현 | RandomForest·1D CNN과 규칙 기반 비교 (spec §6) |
| 양손 제스처 (분해·전체 조립) | 키보드 대체 | numHands 2, 양손 거리 변화 |
| 손목 회전으로 부품 회전 | 휠·키 대체 | 손바닥 법선 각도 추정 |
| qwen3 시뮬레이션 요청 인식 | 해결 (P5-1): 도구 선택 100%, 미근거 숫자 0% | `progress-complete`의 답에 부품 수 빠짐 (1건) |
| LLM 첫 응답 지연 | 서버 시작 시 예열 + `keep_alive=30m` (P5-2, E-04) | VRAM 6GB GPU에선 생성 자체가 17~20s → 8GB 이상 GPU 또는 4B 모델 검토 |
| Rapier 물리 연출 | 오류 낙하 연출 (P5-5) | 부품을 경계 상자로 근사함. 실제 형상 충돌은 GLB 에셋과 함께 |
| Blender GLB 에셋 | 절차적 형상 | `PartVisual`에서 GLB 로더로 교체 |
| CalculiX / OpenFOAM | MVP 제외 | 별도 프로세스 연동 (spec §14) |
