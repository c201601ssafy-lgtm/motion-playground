# Gesture Spec

> 결정 근거: [decision-log.md](decision-log.md) D-002, D-003, D-004, D-014.
> 코드: `frontend/src/features/gestures/` (TS), `backend/app/gestures/` (Python 포팅, 평가용).

## 1. 입력: HandFrame

MediaPipe Hand Landmarker(VIDEO 모드, numHands 2)의 21개 랜드마크로 만든다. 손이 둘이면 직전 주 손과 가까운 손을 주 손으로 골라 한 손 제스처에 쓰고, 두 손 모두는 양손 제스처에 쓴다(P5-7). 영상 프레임은 저장·전송하지 않는다.

| 필드 | 계산 |
|---|---|
| `hand_size` | 손목(0) – 중지 MCP(9) 2D 거리. x는 영상 종횡비로 보정 |
| `pinch_distance` | 엄지 끝(4) – 검지 끝(8) 거리 / `hand_size` |
| `finger_states.<finger>` | 펴짐: `bend(MCP,PIP,TIP) + bend(PIP,DIP,TIP)/2 < 60°` 그리고 손끝이 PIP보다 손목에서 멂 |
| `finger_states.thumb` | `bend(MCP,IP,TIP) < 50°` 그리고 `dist(엄지끝, 검지MCP)/hand_size > 0.55` |
| `finger_folded.<finger>` | 접힘: 손끝이 PIP보다 손목에 가까움 (엄지 제외) |
| `palm_center` | 0, 5, 9, 13, 17 평균 |
| `roll_deg` | 손목(0) → 중지 MCP(9) 방향 각도. 이미지 위쪽 0°, 이미지 오른쪽 +, 종횡비 보정. 손가락 모양과 무관 (P5-6) |

## 2. 규칙 분류기

우선순위대로 첫 번째로 맞는 것:

| 제스처 | 조건 | 명령 |
|---|---|---|
| `PINCH` 🤏 | `pinch_distance < 0.35` (PINCH 유지 중엔 `< 0.5`) **그리고** 검지가 접히지 않음 | 부품 잡기·이동·놓기 |
| `OPEN_PALM` ✋ | 검지·중지·약지·소지 펴짐 (엄지 무관) | 손 이동량 → 모델 회전 |
| `FIST` ✊ | 검지·중지·약지·소지 접힘 | 취소(잡은 부품 원위치) |
| `NONE` | 그 외 | - |

## 3. 상태 머신

```
             같은 후보 ≥ 3프레임, 신뢰도 ≥ 0.6, 마지막 전환 후 ≥ 150ms
   ┌──────┐ ─────────────────────────────────────────────────▶ ┌────────┐
   │ NONE │                                                     │ ACTIVE │──┐ 매 프레임 hold
   └──────┘ ◀───────────────────────────────────────────────── └────────┘◀─┘
             손이 5프레임 연속 안 보임 → end
             다른 제스처로 전환 → (같은 프레임에) end + start
```

- 한 프레임 감지로는 명령을 내지 않는다 (최소 유지 3프레임 ≈ 100ms @30fps).
- 같은 제스처의 `start`는 `end` 전까지 다시 나오지 않는다 (중복 실행 방지).
- 손을 1~4프레임 놓쳐도 진행 중 제스처를 유지한다.

| 파라미터 | 기본값 | 위치 |
|---|---|---|
| `minHoldFrames` | 3 | `stateMachine.ts` |
| `minConfidence` | 0.6 | `stateMachine.ts` |
| `switchCooldownMs` | 150 | `stateMachine.ts` |
| `lostFrames` | 5 | `stateMachine.ts` |
| `pinchEnter` / `pinchExit` | 0.35 / 0.5 | `ruleClassifier.ts` |

## 4. 위치와 필터

- 기준점: PINCH는 엄지·검지 끝의 중점, 나머지는 손바닥 중심.
- 기준점이 바뀌거나 쉬다가 새 제스처가 시작되면 필터를 다시 시작한다(이력 섞임 방지).
- 필터: One Euro(기본, `minCutoff 1.0`, `beta 4.48`(=0.007×640, 정규화 좌표 보정)), EMA(α 0.35), 없음. HUD에서 런타임 전환.

## 5. 명령 매핑 (`GestureCommandSource`)

| 이벤트 | Command |
|---|---|
| PINCH start / hold / end | `GRAB_PART` / `MOVE_PART` / `RELEASE_PART` |
| PINCH hold 중 손목 회전 | `roll` 변화 7.5°마다 `ROTATE_PART(±15°)`. 이미지 + 방향(거울 화면에서 반시계) → +yaw. 잡을 때 각도가 기준 (P5-6) |
| PINCH end 직후 같은 프레임에 FIST start | `RELEASE_PART` 대신 `CANCEL` |
| OPEN_PALM hold | `ROTATE_MODEL(dYaw = -Δx·3π, dPitch = Δy·3π)` + `HOVER` |
| FIST start | `CANCEL` |
| 양손 OPEN_PALM, 1.5초 안에 손 사이 거리 ×1.5 이상 | `EXPLODE(on: true)` (분해, 키 E) |
| 양손 OPEN_PALM, 1.5초 안에 손 사이 거리 ×0.6 이하 | `ASSEMBLE_ALL` (전체 조립·접기, 키 A) |

- 화면 좌표 = 거울 반전(1 − x) 후 중앙 기준 1.5배 확대, 0..1로 자름.
- 부품 이동은 카메라를 향한 드래그 평면 위에서만 한다. 손 깊이(z)는 쓰지 않는다.
- 양손 거리는 손바닥 중심 사이 거리 / 두 손 크기 평균이라 카메라와의 거리에 덜 민감하다. 두 손이 3프레임 이상 함께 펼쳐져야 기준을 잡고, 한 번 낸 뒤 1.5초는 다시 내지 않는다. 두 손을 펼친 동안에는 한 손 제스처(모델 회전)를 멈춘다.
- 손목 회전은 한 칸 단위(7.5°)로 끊어서 손 떨림(±3°)에는 반응하지 않는다. 손목 90°로 부품 180°(커버 뒤집기)를 할 수 있다. 휠·`[` `]` 키도 그대로 쓸 수 있다.

## 6. 이벤트 스키마

`schemas/gesture-event.schema.json` — 프론트(Ajv)와 백엔드(jsonschema) 테스트가 같은 스키마로 검증한다.

```json
{ "type": "PINCH", "phase": "hold", "position": { "x": 0.42, "y": 0.58, "z": -0.01 },
  "delta": { "x": 0.004, "y": -0.002 }, "roll": -12.5, "confidence": 0.93, "timestamp": 1834.2 }
```

## 7. 데이터 녹화

- 화면 `#/record`: 피험자 ID(익명 코드), 조명, 라벨 선택 → 3초 카운트다운 → 2초 녹화 → JSONL 다운로드.
- 형식: `schemas/gesture-record.schema.json` (랜드마크만, 이미지 필드는 스키마가 거부).
- 합성 샘플: `evals/gesture-records-sample.jsonl` (`source: "synthetic"`, `npm run gen:gesture-samples`).

## 8. 검증 데이터

| 파일 | 내용 | 생성 |
|---|---|---|
| `evals/gesture-cases.jsonl` | 합성 33프레임: 특징·제스처 기대값 (TS·Python 동일성) | `npm run gen:gesture-cases` |
| `evals/gesture-events-sample.jsonl` | 파이프라인 이벤트 샘플 | `npm run gen:gesture-samples` |
| `evals/gesture-records-sample.jsonl` | 합성 녹화 36클립 (3명×3조명×4라벨) | `npm run gen:gesture-samples` |

## 9. 수동 확인 체크리스트 (실제 웹캠)

- [ ] 손바닥을 펴고 좌우로 움직이면 모델이 같은 방향으로 돈다.
- [ ] 부품 위에서 엄지·검지를 붙이면 부품이 초록색으로 잡히고 손을 따라온다.
- [ ] 손가락을 떼면 그 자리에 놓인다.
- [ ] 잡은 상태에서 주먹을 쥐면 원위치로 돌아간다.
- [ ] 잡은 상태에서 손목을 돌리면(문고리 돌리듯) 부품이 15°씩 돈다. 화면에서 손이 도는 방향과 부품이 도는 방향이 같다. 가만히 들고 있을 때는 돌지 않는다.
- [ ] 주먹을 쥘 때 "집기"로 잘못 바뀌지 않는다.
- [ ] 손을 화면 밖으로 빼면 0.2초 안에 커서가 사라진다.
- [ ] 분해 모드에서 두 손을 펼친 채 빠르게 벌리면 분해, 모으면 접힌다. 이때 모델은 돌지 않는다.
- [ ] 한 손으로 부품을 잡고 다른 손을 화면에 넣어도 잡은 부품이 다른 손으로 넘어가지 않는다.
- [ ] 어두운 조명에서 오인식이 늘면 HUD에서 필터를 바꿔 비교한다.
