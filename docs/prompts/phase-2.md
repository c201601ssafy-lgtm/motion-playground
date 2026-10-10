# Phase 2 — 웹캠 손 추적 + 제스처 + 안정화 + 명령 연결 + 녹화

`docs/decision-log.md`(D-002, D-003, D-004, D-008)를 다시 읽어라. Phase 1 코드 구조(CommandBus, CommandSource)를 그대로 사용한다.

## 만들 것

1. **카메라** `src/features/camera/`: `getUserMedia`(640×480, facingMode user), 권한 거부/장치 없음 에러 UI, 좌우 반전 미리보기.
2. **손 추적** `src/features/hand-tracking/`
   - `@mediapipe/tasks-vision` HandLandmarker, VIDEO 모드, GPU→CPU 폴백, numHands 1. wasm/모델 경로는 상수로 분리.
   - `requestVideoFrameCallback` 루프(미지원 시 rAF). React 렌더와 분리된 클래스 `HandTracker`.
   - 출력 `HandFrame`(spec §5 필드: handedness, confidence, landmarks, palm_center, 손 크기로 정규화한 pinch_distance, finger_states, timestamp).
   - 랜드마크 오버레이 캔버스(디버그 토글).
3. **제스처** `src/features/gestures/` — 순수 TS, React 의존 없음 (`gesture-command-kit`로 분리 가능하게)
   - `features.ts`: 손가락 펼침 판정(관절 각도 기반), 정규화 집기 거리.
   - `ruleClassifier.ts`: D-002 규칙 → `{type, confidence}`.
   - `stateMachine.ts`: 최소 유지 프레임(기본 3), 신뢰도 임계값(0.6), 전환 쿨다운(150ms), PINCH 히스테리시스, `start/hold/end` phase 이벤트, 같은 start 중복 방지.
   - `filters.ts`: `EmaFilter`, `OneEuroFilter`(minCutoff 1.0, beta 0.007 기본). 위치에 적용, 런타임 전환 가능.
   - `GestureCommandSource`: GestureEvent → Command. PINCH start=GRAB_PART, hold=MOVE_PART, end=RELEASE_PART / OPEN_PALM hold=ROTATE_MODEL(delta×감도) / FIST start=CANCEL. 화면 좌표는 거울 반전 고려.
   - 공통 이벤트 JSON Schema `schemas/gesture-event.schema.json`(루트). 프론트·백엔드 테스트 모두 이 스키마로 검증.
4. **3D 조작 연결**
   - GRAB_PART: raycast로 부품 선택 → 카메라를 향한 드래그 평면 생성. MOVE_PART: 평면 위 이동. RELEASE_PART: 놓기(판정은 Phase 3). CANCEL: 원위치.
   - 손 커서(화면 위 원) + 호버 하이라이트. 마우스와 제스처 소스 동시 동작.
5. **HUD (연구실 화면)**: 웹캠 미리보기, 추적 상태(손 감지/fps), 현재 제스처·신뢰도·phase, 필터 선택, 조작 안내.
6. **녹화** `/record` 화면 (D-008): 라벨/조명/피험자 ID 선택, 카운트다운, 2초 랜드마크 녹화, JSONL 다운로드. 이미지 저장 금지.
7. **지연 계측**: capture→landmark→classify→command 단계별 `performance.now()` 링버퍼, HUD에 p50/p95.
8. **테스트**
   - `evals/gesture-cases.jsonl`: 라벨별 최소 3개 합성 랜드마크 시퀀스(실데이터 전 임시, `source: "synthetic"` 표기).
   - Vitest: 분류기(케이스 파일 기반), 상태 머신(유지 프레임 미만 무시, 히스테리시스, 쿨다운, 중복 start 방지), One Euro(정지 시 분산 감소), GestureCommandSource 매핑.
   - 백엔드: `backend/app/gestures/rule_classifier.py` Python 포팅 + 같은 `gesture-cases.jsonl`로 TS와 동일 결과 테스트.
9. `docs/gesture-spec.md`: 제스처 정의, 임계값, 상태 머신 다이어그램.

## 완료 조건

- spec §22의 1~6번이 실제 웹캠으로 동작(손 감지 → 제스처 표시 → 집어서 부품 이동 → 펼친 손으로 모델 회전 → 주먹으로 취소).
- CI 전부 통과(웹캠/GPU 없이). 실행 결과 보여줘.
- 임계값 튜닝 필요한 부분 + 내가 직접 웹캠으로 확인할 체크리스트 정리.
