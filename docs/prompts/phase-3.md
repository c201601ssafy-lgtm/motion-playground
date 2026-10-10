# Phase 3 — 분해·조립 모드 + 오류 판정 UI + 작동 모드

`docs/decision-log.md`(D-005, D-006, D-010)를 다시 읽어라. 판정은 반드시 백엔드 AssemblyEngine이 한다. 프론트에 판정 로직을 복제하지 말 것(가장 가까운 슬롯 표시만 허용).

## 만들 것

1. **모드 상태** (Zustand): `lab | disassemble | assemble | operate | tutor | results`. 상단 탭 + 키보드 단축키. 모드 전환도 Command(`SET_MODE`)로.
2. **분해 모드**
   - EXPLODE 명령 → 부품이 슬롯 축 방향으로 펼쳐지는 애니메이션(parts.yaml에 `explode_offset` 추가).
   - 부품 목록 패널: 이름, 기능 설명, 조립 단계. 목록 클릭/집기 = 선택 + 카메라 포커스.
3. **조립 모드**
   - 시작 시 세션 생성(`POST /api/sessions`), 모든 부품을 작업대 영역에 흩어 배치.
   - 드래그 중: 반경 내 가장 가까운 슬롯 고스트(반투명 실루엣) + 거리 표시.
   - RELEASE_PART → `POST /attempt`(part_id, position, axis, yaw). 성공 시 슬롯으로 스냅 애니메이션. 실패 시 error_type별 한국어 오류 토스트(기대값/현재값 포함) 후 놓은 자리 유지(TOO_FAR) 또는 작업대 복귀(그 외).
   - 부품 yaw 회전: 잡은 상태에서 Q/E 키 또는 마우스 휠. 방향 오류를 실제로 재현할 수 있어야 함.
   - 진행률 바(단계 n/4, 부품 n/8), 현재 단계 안내, RESET_STEP / ASSEMBLE_ALL(데모용 자동 조립).
4. **작동 모드**
   - `GET /mechanism?input_rpm=` 결과로만 회전. 프론트에서 기어비 계산 금지.
   - operable=false면 사유 표시("출력 기어 미조립" 등 — 엔진이 사유 반환하도록 확장).
   - 입력 rpm 슬라이더(0~60), 기어별 회전 방향 화살표, 이빨 수·기어비·rpm 라벨, 맞물림 지점 하이라이트.
   - 하단 고정 문구: "교육용 시각화이며 실제 설계·제조·안전 판단에 사용할 수 없습니다."
5. **세션 이벤트 로그**: attempt 결과를 세션별로 기록(시각, part, error_type). Phase 4 결과 화면·AI가 사용.
6. **테스트**
   - 백엔드: 엔진 확장(operable 사유, 이벤트 로그), API 통합 테스트(TestClient로 전체 조립 → mechanism).
   - `evals/assembly-cases.jsonl` 오류 케이스 10개 이상(error_type마다 ≥1).
   - 프론트 Vitest: 가장 가까운 슬롯 계산, 오류 메시지 매핑, store 모드 전환.
7. 문서: `docs/architecture.md`에 조립 시퀀스(드래그→놓기→판정→스냅) 추가.

## 완료 조건

- spec §22의 7, 8, 11번이 마우스·제스처 양쪽으로 동작: 올바른 슬롯 스냅, 잘못된 슬롯/순서/방향 오류 표시, 작동 모드에서 아이들러 반대 방향·출력 1/3 속도 회전.
- CI 통과. 실행 결과 보여줘.
- 5~10분 데모 시나리오 초안을 README에 추가.
