# HoloForge AI Lab

웹캠 손동작으로 3D 기어박스를 분해·조립하고, AI 튜터가 부품의 역할과 작동 원리를 설명하는 제스처 기반 공학 체험 서비스.

> 투명 디스플레이 사용 시 표현: "투명 디스플레이 또는 Pepper’s Ghost 방식의 홀로그램 유사 시각화". 실제 자유공간 홀로그램이 아니다.
> 교육용 시뮬레이션이며 실제 설계·제조·안전 판단에 사용할 수 없습니다.

## 문서

- [구현 계획 / 진행 상태](docs/implementation-plan.md)
- [결정 기록](docs/decision-log.md)
- [원본 명세](docs/spec.md)

## 실행

요구: Node 20+, [uv](https://docs.astral.sh/uv/) (Python 3.12 자동 설치)

```bash
# 백엔드
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000

# 프론트엔드 (다른 터미널)
cd frontend
npm install
npm run dev          # http://localhost:5173, /api → localhost:8000 프록시
```

백엔드 포트를 바꾸면 프론트에 `HOLOFORGE_API_URL=http://localhost:8010 npm run dev`.

## 검사

```bash
cd backend && uv run ruff check . && uv run ruff format --check . && uv run pytest
cd frontend && npm run typecheck && npm test && npm run build
```

## 데모 시나리오 (5~10분)

| 시간 | 화면 | 진행 |
|---|---|---|
| 0:00 | 연구실(1) | "카메라 켜기" → 손을 올리면 랜드마크·제스처 표시. 펼친 손을 좌우로 움직여 기어박스 회전 |
| 1:00 | 분해(2) | 분해도로 펼쳐짐. 부품 목록에서 아이들러 기어 클릭 → 역할 설명, 나머지 흐리게 |
| 2:30 | 조립(3) | 작업대의 부품을 집기(🤏)로 옮김. 일부러 축을 베이스보다 먼저 놓아 **받침 부품 먼저** 오류 확인 |
| 3:30 | 조립(3) | 베이스를 90° 돌려 놓아 **방향 틀림**(기대 0°/현재 90°) 확인 → 바로 놓아 1단계 완료 |
| 4:30 | 조립(3) | 출력축을 입력축 자리에 놓아 **다른 부품의 자리** 확인 → 축 3개·기어 3개·커버 조립 완료 |
| 6:00 | 작동(4) | 입력 30rpm → 아이들러는 반대(시계), 출력은 같은 방향 10rpm. 슬라이더로 -30rpm 반전 |
| 7:00 | AI 튜터(5) | "왜 아이들러는 반대로 돌아?" 질문 → 도구 호출 내역과 함께 설명 (Phase 4) |
| 8:30 | 실험 결과(6) | 제스처 지연 p50/p95, 조립 시간·오류 횟수 (Phase 4) |

웹캠이 없으면 마우스로 같은 시나리오를 진행할 수 있다(왼쪽 드래그=집기, 휠=부품 회전, 오른쪽 드래그=회전).
