# Architecture

> 결정 근거는 [decision-log.md](decision-log.md), 진행 상태는 [implementation-plan.md](implementation-plan.md).

## 처리 흐름

```
[브라우저]
 웹캠 ─▶ HandTracker(MediaPipe, VIDEO 모드)
      ─▶ FeatureExtractor(손가락 펼침, 정규화 집기 거리)
      ─▶ RuleClassifier(OPEN_PALM / PINCH / FIST / NONE)
      ─▶ GestureStateMachine(유지 프레임, 히스테리시스, 쿨다운)
      ─▶ OneEuroFilter(위치)
      ─▶ GestureCommandSource ─┐
         MouseCommandSource ───┼─▶ CommandBus ─▶ GearboxScene (raycast, 드래그 평면, 회전)
         KeyboardCommandSource ┘                     │ RELEASE_PART
                                                     ▼
[백엔드 FastAPI]                         POST /api/sessions/{id}/attempt
 ModelLoader ─▶ AssemblyEngine(판정·기구 계산) ◀─ Tools ◀─ Tutor ◀─ LLMAdapter(Ollama | Mock)
 SessionStore(SQLite)
```

## 계층 규칙

| 계층 | 아는 것 | 모르는 것 |
|---|---|---|
| 비전/제스처 (`features/hand-tracking`, `features/gestures`) | 랜드마크, 정규화 화면 좌표 | 3D 씬, 부품 |
| Command (`features/commands`) | 명령 타입, 정규화 화면 좌표(0..1) | 입력 장치 종류(소스 이름만), 씬 |
| 3D (`three/`) | 씬, 카메라, raycast, 부품 메시 | 입력 장치 |
| AssemblyEngine (`backend/app/assembly`) | 모델 데이터, 규칙, 상태 | 화면, LLM |
| AI (`backend/app/ai`, `tools`) | 도구 결과 | 엔진 내부 (도구로만 접근) |

## 데이터

- `models/gearbox/*.yaml` → `app/core/model_loader.py`(Pydantic + 참조 무결성) → `GET /api/models/gearbox` → 프론트 씬 생성.
- 세션 상태 `AssemblyState{placed: slot→part, last_error}`는 SQLite `sessions.state_json`에 저장. 변경은 `BEGIN IMMEDIATE` 트랜잭션 안에서 read-modify-write.

## 좌표

- y-up, 1 단위 ≈ 10cm. 기어 피치 반지름 = module × teeth / 2 (module 0.05).
- 화면 좌표(Command)는 캔버스 기준 0..1, y는 아래로 증가.
