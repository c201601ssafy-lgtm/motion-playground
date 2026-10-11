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
| @mediapipe/tasks-vision | 1.1.0 | Apache-2.0 | 없음 (wasm은 jsDelivr CDN에서 로드) |
| ajv / ajv-formats (dev) | 8.20.0 / 3.0.1 | MIT | 없음 |
| tsx (dev) | 4.23.15 | MIT | 없음 |
| @dimforge/rapier3d | 0.20.0 | Apache-2.0 | 없음 (낙하 연출, 조립 모드에서 지연 로드) |
| @dimforge/rapier3d-compat (dev) | 0.20.0 | Apache-2.0 | 없음 (Node 테스트용, wasm 내장판) |
| vite-plugin-wasm (dev) | 3.6.0 | MIT | 없음 |

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
| httpx | 0.28.1 | BSD-3-Clause | 없음 (Ollama 호출) |
| jsonschema (dev) | 4.26.0 | MIT | 없음 |

## 모델·런타임

| 이름 | 버전 | 용도 | 라이선스 | 배포 방식 |
|---|---|---|---|---|
| MediaPipe Hand Landmarker (`hand_landmarker.task` float16) | 2023 릴리스 | 손 랜드마크 | Apache-2.0 | Google CDN에서 브라우저가 직접 로드, 저장소에 포함 안 함 |
| Qwen3-8B (`qwen3:8b` Q4_K_M) | Ollama 레지스트리 | AI 튜터 | Apache-2.0 | 사용자가 `ollama pull`, 가중치 미배포 |
| Ollama | 0.40.2 | LLM 런타임 | MIT | 별도 프로세스, HTTP로만 연결 |

## 데이터·에셋

| 이름 | 출처 | 라이선스 | 비고 |
|---|---|---|---|
| 기어박스 3D 형상 | 자체 코드 (`frontend/src/three/gearShape.ts`) | 프로젝트 MIT | 외부 에셋 없음 |
| 합성 제스처 데이터 (`evals/gesture-*.jsonl`) | 자체 생성 스크립트 | 프로젝트 MIT | `source: synthetic` |
| MediaPipe 샘플 손 사진 | storage.googleapis.com/mediapipe-tasks | Google 샘플 | 로컬 스모크 테스트에만 사용, 저장소에 포함 안 함 |

## GPL 계열 검토

- Blender(GPL): 도구로만 사용. 산출물(GLB)은 GPL 적용 대상 아님. 현재 MVP는 절차적 지오메트리라 미사용.
- CalculiX(GPL), OpenFOAM(GPL): MVP 이후. 별도 프로세스로 실행하고 입출력 파일로만 연결(링크 결합 없음).
- 3D 기어 형상: 자체 코드(`frontend/src/three/gearShape.ts`)로 생성. 외부 에셋 없음.
