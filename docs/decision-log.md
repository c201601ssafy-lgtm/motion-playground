# Decision Log

> 오피스 아워(2026-10-11) 결과. 모든 항목은 추천안으로 확정. 변경 시 아래에 새 항목 추가(기존 항목 수정 금지).

## D-001 MVP 모델: 3-기어 감속 기어박스 (로봇팔 X)

- 이유: 강체 + 고정축이라 조립 규칙이 단순함. 회전 방향·기어비를 교육적으로 보여주기 쉬움. 로봇팔은 관절 제한·역기구학·자세 판정이 붙어 범위가 커짐.
- 구성 (8부품):

| part_id | 이름 | 단계 | 슬롯 |
|---|---|---|---|
| `base-plate` | 베이스 플레이트 | 1 | `slot-base` |
| `shaft-input` | 입력축 | 2 | `slot-shaft-a` |
| `shaft-idler` | 아이들러축 | 2 | `slot-shaft-b` |
| `shaft-output` | 출력축 | 2 | `slot-shaft-c` |
| `gear-input-12t` | 입력 기어 12T | 3 | `slot-gear-a` |
| `gear-idler-24t` | 아이들러 기어 24T | 3 | `slot-gear-b` |
| `gear-output-36t` | 출력 기어 36T | 3 | `slot-gear-c` |
| `top-cover` | 상부 커버 | 4 | `slot-cover` |

- 기어 모듈 m = 0.05(씬 단위) → 피치 반지름 0.3 / 0.6 / 0.9. 축 중심 x = 0, 0.9, 2.4.
- 전체 감속비 36/12 = 3:1. 입력·출력 같은 방향, 아이들러는 반대 방향 → "왜 반대로 돌아?" 질문의 교재.
- **3D 모델은 Blender GLB 대신 Three.js 절차적 생성(Cylinder/Extrude 기어)으로 시작.** GLB 교체는 `PartVisual` 어댑터로 나중에. 이유: 에셋 제작이 일정 최대 병목.

## D-002 첫 제스처 3개

| 제스처 | 판정 규칙(초기값) | 명령 |
|---|---|---|
| `PINCH` | 엄지끝(4)-검지끝(8) 거리 / 손 크기(0→9 거리) < 0.35, 해제는 > 0.5 (히스테리시스) | 부품 잡기·이동 |
| `OPEN_PALM` | 5손가락 모두 펼침 | 손 이동량 → 모델 회전(orbit) |
| `FIST` | 엄지 제외 4손가락 접힘 | 선택 해제 / 잡기 취소 |

- 손목 roll 회전은 노이즈 큼 → **회전은 "펼친 손 이동량"으로 대체.** 손목 roll은 2단계 실험 항목.
- 그 외 상태는 `NONE`. 양손 제스처(분해/조립)는 MVP에서 버튼 + 키보드로 대체, 이후 추가.

## D-003 브라우저 손 추적 구조

- `@mediapipe/tasks-vision` `HandLandmarker`, `runningMode: "VIDEO"`, `delegate: "GPU"`(실패 시 CPU), `numHands: 1`(MVP).
- 루프: `getUserMedia` → `<video>` → `requestVideoFrameCallback`(미지원 시 rAF) → `detectForVideo` → `HandFrame` 생성.
- 파이프라인(전부 순수 함수/클래스, React 밖):
  `HandLandmarker → FeatureExtractor → RuleClassifier → GestureStateMachine(유지·히스테리시스·쿨다운) → OneEuroFilter(위치) → CommandMapper → CommandBus`
- 프레임/이미지는 서버 전송·저장 안 함. 랜드마크만 메모리에 둠. 녹화 기능도 랜드마크 JSONL만.
- 성능 목표: 노트북 내장 GPU에서 추적 ≥ 24fps. 부족하면 Web Worker(OffscreenCanvas)로 이동.

## D-004 Gesture Command Mapper 인터페이스

```ts
type GestureType = "NONE" | "OPEN_PALM" | "PINCH" | "FIST";

interface GestureEvent {          // 공통 이벤트 스키마 (JSON Schema로도 정의)
  type: GestureType;
  phase: "start" | "hold" | "end";
  position: { x: number; y: number; z: number }; // 정규화 0..1, 필터 적용 후
  delta: { x: number; y: number };                // 이전 프레임 대비
  confidence: number;
  timestamp: number;                               // performance.now() ms
}

type Command =
  | { type: "HOVER"; screen: { x: number; y: number } }
  | { type: "GRAB_PART"; screen: { x: number; y: number } }
  | { type: "MOVE_PART"; screen: { x: number; y: number } }
  | { type: "RELEASE_PART" }
  | { type: "ROTATE_MODEL"; dYaw: number; dPitch: number }
  | { type: "CANCEL" }
  | { type: "EXPLODE" } | { type: "ASSEMBLE_ALL" } | { type: "RESET_STEP" };

interface CommandSource { start(bus: CommandBus): void; stop(): void; } // gesture / mouse / keyboard
```

- Mapper는 화면 좌표까지만 만든다. `target_id`·월드 좌표 결정은 3D 계층(raycast + 드래그 평면)이 한다 → 비전 코드가 씬을 모름.
- 부품 이동은 **카메라를 향한 드래그 평면 위 2D 이동.** 손 z(깊이)는 쓰지 않음(불안정).
- 마우스 소스를 먼저 만들어 3D/조립을 웹캠 없이 개발·테스트.

## D-005 3D 부품 데이터 구조

- 단일 진실 원천: `models/gearbox/{parts,connections,assembly-steps}.yaml`. 백엔드가 Pydantic으로 로드·검증 후 `GET /api/models/gearbox`로 JSON 제공. 프론트는 이 JSON으로 씬 생성.
- `parts.yaml`: `part_id, name, description, function, mass, kind(base|shaft|gear|cover), geometry{...}, teeth?, rotation_axis, step, collider{type: box|cylinder, size}`
- `connections.yaml`(슬롯): `slot_id, accepts_part_id, parent_part_id|null, position[x,y,z], axis[x,y,z], orientation_rule(axis_only|axis_and_yaw), yaw_deg?, snap_radius`
- `assembly-steps.yaml`: `step, title, slots[], requires_steps[]`
- 기어비·회전 방향은 저장하지 않고 이빨 수와 맞물림 그래프에서 계산(`meshes_with` 리스트 in connections).
- 시각 메시(절차적)와 충돌체(box/cylinder) 분리.

## D-006 Assembly Engine 규칙 (Python, 판정 권한 보유)

`attempt(part_id, position, axis, yaw_deg) → AssemblyResult`. 검사 순서 고정:

1. `UNKNOWN_PART` – 부품 없음
2. `ALREADY_PLACED` – 이미 조립됨
3. `TOO_FAR` – 반경 내 슬롯 없음(가장 가까운 슬롯 거리 > `snap_radius`, 기본 0.25) → 조립 시도 아님, 원위치 X 그냥 놓음
4. `WRONG_SLOT` – 가까운 슬롯이 다른 부품용
5. `SLOT_OCCUPIED`
6. `MISSING_PARENT` – 부모 부품(예: 기어의 축) 미조립
7. `WRONG_ORDER` – `requires_steps` 미완료
8. `WRONG_ORIENTATION` – 축 각도 차 > 15°, 또는 `axis_and_yaw`에서 yaw 차 > 15°(180° 대칭 허용)
9. 통과 → `is_valid: true`, 슬롯 위치로 스냅

- `mechanism_state()`: 모든 기어 조립 + 맞물림 체인 연결 시 `operable: true`, 각 기어 `ratio`, `direction(+1/-1)`, `rpm(input_rpm)` 계산.
- 프론트는 드래그 중 가장 가까운 슬롯 하이라이트만(표시용). 놓을 때 `POST /api/sessions/{id}/attempt`로 판정. 판정은 놓을 때 1회라 지연 무관.
- 모든 오류 타입은 `evals/assembly-cases.jsonl`로 회귀 테스트.

## D-007 AI 도구 호출 인터페이스

```python
class LLMAdapter(Protocol):
    def chat(self, messages: list[Message], tools: list[ToolSpec]) -> LLMResponse: ...
# 구현: OllamaAdapter(qwen3:8b, think=False), MockAdapter(규칙 기반, CI용)
```

- 도구(Pydantic 입력·출력 스키마, 세션 상태만 읽음/제한된 변경):
  - `get_part_info(part_id)` – 이름, 기능, 연결, 이빨 수
  - `get_assembly_state()` – 완료 단계, 현재 단계, 조립된 부품
  - `get_assembly_error()` – 마지막 판정 결과
  - `get_mechanism_state()` – operable, 기어별 비·방향 (엔진 계산값)
  - `run_visual_simulation(input_rpm)` – 프론트에 애니메이션 이벤트 발행, 계산값 반환
  - `reset_assembly_step()` – 현재 단계 부품 원위치
- 루프: 최대 4회 도구 호출 → 최종 답. 응답 스키마 `{answer, used_tools[], cited_values{}}`. 답변 속 숫자가 도구 결과에 없으면 경고 플래그(환각 감지).
- 시스템 프롬프트에 구조화 컨텍스트(spec §12)만 넣음. 전체 상태 덤프 금지.
- `POST /api/sessions/{id}/tutor` (MVP는 REST, 스트리밍은 이후 WebSocket).

## D-008 첫 제스처 데이터 수집

- 앱 내 `/record` 화면: 라벨 선택 → 3-2-1 카운트 → 2초(≈60프레임) 랜드마크 녹화 → JSONL 다운로드. 이미지 저장 없음.
- 레코드: `{subject_id(익명), lighting(bright|normal|dim), handedness, label, fps, frames:[{t, landmarks[21][3], handedness_score}]}`
- 1차 목표: 7명 × 라벨 4종(NONE 포함) × 조명 3 × 10클립 = 840클립.
- 저장: `datasets/gestures/raw/*.jsonl`(git LFS 또는 외부; 동의서 받은 것만). CI용 소량 샘플은 `evals/gesture-cases.jsonl`.
- 분할: **사용자 단위 분리**(leave-one-subject-out) — 같은 사람이 train/test 양쪽에 들어가지 않게.

## D-009 정확도·지연시간 평가

- 정확도: `backend/scripts/eval_gestures.py` — JSONL 재생 → Python 포팅 규칙 분류기 + 상태 머신 → Accuracy, Macro F1, 제스처별 P/R, 혼동행렬, 사용자별·조명별 표. (TS/Python 분류기 동일 결과는 공유 테스트 케이스로 보장)
- 안정화: 정지 구간 위치 분산, 오전환 횟수/분, 필터별(EMA, One Euro) 비교.
- 지연: 프론트에서 단계별 `performance.now()` 계측(capture→landmark→classify→command→render) p50/p95를 `/results` 화면 표시 + JSON 내보내기. 목표: landmark p95 < 50ms, 제스처 확정(유지 프레임 포함) < 200ms.
- AI: `evals/tool-call-cases.jsonl` — 질문 → 기대 도구·인자. Mock은 CI, Ollama는 수동 실행 리포트.
- 결과는 `docs/experiments.md`에 "문제→기준→원인→개선→재측정→결과" 형식.

## D-010 프론트/백엔드 책임

| 프론트 (React+TS+R3F) | 백엔드 (FastAPI) |
|---|---|
| 카메라, 손 추적, 제스처, 필터, 명령 | 모델 데이터 로드·검증·제공 |
| 3D 렌더, raycast, 드래그, 스냅 미리보기 | 조립 판정(권한), 세션 상태(SQLite) |
| 기어 회전 애니메이션(백엔드 값 사용) | 기구 상태 계산(비·방향) |
| 튜터 UI, 결과 화면, 녹화 | LLM adapter, 도구, 평가 스크립트 |

- 렌더링은 **React Three Fiber + drei**. 상태는 Zustand.
- **Rapier는 MVP 필수 아님.** 기어 회전은 계산된 비율로 키네매틱 애니메이션(물리 기어는 불안정). Rapier는 "잘못 놓은 부품 떨어짐" 연출용으로 4단계 선택 사항.

## D-011 7인 역할

| # | 역할 | 담당 |
|---|---|---|
| 1 | PM / 통합 | 일정, decision-log, 데모 시나리오, 통합 테스트 |
| 2 | 비전 | 손 추적, 특징 추출, 규칙 분류기 |
| 3 | 인터랙션 | 상태 머신, 필터, Command Mapper, `gesture-command-kit` |
| 4 | 3D | R3F 씬, 절차적 기어, 드래그·스냅·애니메이션 |
| 5 | 백엔드 | FastAPI, Assembly Engine, 데이터 스키마, CI |
| 6 | AI | LLM adapter, 도구, 프롬프트, 도구호출 평가 |
| 7 | 데이터·평가 | 녹화 도구, 데이터 수집, 평가 스크립트, experiments.md, licenses.md |

## D-012 가장 큰 기술 위험 (우선순위순)

1. **제스처 오인식·떨림** – 집기 도중 놓침, 펼침↔집기 오전환. 대응: 손 크기 정규화, 히스테리시스, 유지 프레임, One Euro, 마우스 폴백 상시 유지.
2. **2D 손 → 3D 배치** – 깊이 부정확. 대응: 드래그 평면 + 넓은 스냅 반경 + 슬롯 하이라이트.
3. **로컬 LLM 품질·속도** – Qwen3-8B 4bit 도구 호출 실패·지연(VRAM 6GB+ 필요). 대응: adapter 교체 가능, think=False, 도구 수 최소, MockAdapter로 데모 백업, 숫자 환각 검사.
4. **브라우저 성능** – MediaPipe + 3D 동시 구동. 대응: 해상도 640×480, 그림자 최소, 필요 시 Worker.
5. **에셋 제작 시간** – 대응: 절차적 지오메트리(D-001).
6. **라이선스** – Blender 산출물은 GPL 아님(도구만 GPL), CalculiX/OpenFOAM은 별도 프로세스 호출로 분리. `licenses.md`에 기록.
