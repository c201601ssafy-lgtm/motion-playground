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
