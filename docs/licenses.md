# Licenses

> 사용 중인 오픈소스의 버전·라이선스·수정 여부. 의존성 추가 시 갱신한다. (기준일 2026-10-11)

## 프론트엔드 (npm)

| 패키지 | 버전 | 라이선스 | 수정 여부 |
|---|---|---|---|
| react / react-dom | 19.3.0 | MIT | 없음 |
| three | 0.186.1 | MIT | 없음 |
| @react-three/fiber | 9.8.1 | MIT | 없음 |
| @react-three/drei | 10.7.9 | MIT | 없음 |
| zustand | 5.0.15 | MIT | 없음 |
| vite | 8.3.4 | MIT | 없음 |
| vitest | 5.0.3 | MIT | 없음 |
| typescript | 7.0.2 | Apache-2.0 | 없음 |

## 백엔드 (Python)

| 패키지 | 버전 | 라이선스 | 수정 여부 |
|---|---|---|---|
| fastapi | 0.143.0 | MIT | 없음 |
| uvicorn | 0.54.0 | BSD-3-Clause | 없음 |
| pydantic / pydantic-settings | 2.14.0 / 2.15.0 | MIT | 없음 |
| PyYAML | 6.0.3 | MIT | 없음 |
| pytest (dev) | 9.1.1 | MIT | 없음 |
| httpx (dev) | 0.28.1 | BSD-3-Clause | 없음 |
| ruff (dev) | 0.17.0 | MIT | 없음 |

## 예정 (Phase 2~4)

| 이름 | 용도 | 라이선스 | 비고 |
|---|---|---|---|
| @mediapipe/tasks-vision | 손 랜드마크 | Apache-2.0 | 모델 파일(hand_landmarker.task)도 Apache-2.0 |
| Qwen3-8B | AI 튜터 LLM | Apache-2.0 | Ollama로 로컬 실행, 가중치 미배포 |
| Ollama | LLM 런타임 | MIT | 별도 프로세스, HTTP로만 연결 |

## GPL 계열 검토

- Blender(GPL): 도구로만 사용. 산출물(GLB)은 GPL 적용 대상 아님. 현재 MVP는 절차적 지오메트리라 미사용.
- CalculiX(GPL), OpenFOAM(GPL): MVP 이후. 별도 프로세스로 실행하고 입출력 파일로만 연결(링크 결합 없음).
- 3D 기어 형상: 자체 코드(`frontend/src/three/gearShape.ts`)로 생성. 외부 에셋 없음.
