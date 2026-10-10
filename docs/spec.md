# HoloForge AI 프로젝트 개발 명세 (원본)

> 원본 개발 프롬프트를 보존한 문서. 결정사항은 `decision-log.md`가 우선한다.

## 1. 프로젝트 개요

HoloForge AI는 웹캠으로 사용자의 손동작을 인식해 3D 공학 모델을 선택·회전·분해·조립하고, AI가 부품의 역할과 작동 원리를 설명하는 제스처 기반 공학 체험 서비스다.

사용자는 마우스나 키보드 대신 손동작으로 기계 장치를 조작한다.

첫 MVP에서는 복잡한 공학 해석보다 다음 경험에 집중한다.

1. 손으로 3D 모델을 선택한다.
2. 손을 움직여 모델을 회전한다.
3. 특정 제스처로 모델을 분해한다.
4. 부품을 올바른 위치에 조립한다.
5. AI에게 부품의 기능과 작동 원리를 질문한다.
6. 잘못 조립하면 AI가 원인과 수정 방법을 설명한다.

화면이나 투명 스크린의 3D 이미지를 실제 자유공간 홀로그램이라고 표현하지 않는다. 프로젝터와 투명 스크린을 사용할 경우 다음과 같이 설명한다.

> 투명 디스플레이 또는 Pepper’s Ghost 방식의 홀로그램 유사 시각화

## 2. MVP 범위

첫 MVP는 기어박스 또는 간단한 로봇팔 중 하나만 구현한다. 가장 추천하는 MVP는 3단 기어박스다.

- 3D 공학 모델 1개, 주요 부품 5~8개, 손동작 5개
- 분해 모드, 조립 모드, 작동 시뮬레이션, AI 설명 모드, 조립 오류 판정
- 예상 체험 시간 5~10분

지원 제스처: 손바닥 펼치기(모델 선택), 검지·엄지 집기(부품 잡기), 손 이동(부품 이동), 손목 회전(모델 회전), 주먹 쥐기(선택 해제), 양손 벌리기(분해), 양손 모으기(전체 조립).
초기에는 선택·이동·회전 세 가지부터 안정화한다.

## 3. 추천 기술 스택

- 프론트엔드: React, TypeScript, Vite, Three.js 또는 React Three Fiber, Rapier, MediaDevices API, Zustand, CSS Modules 또는 Tailwind CSS
- 컴퓨터 비전: MediaPipe Hand Landmarker, OpenCV, NumPy, (선택) scikit-learn, PyTorch
- 백엔드: Python 3.12, FastAPI, WebSocket, Pydantic, SQLite, pytest, Ruff
- AI·오픈소스: MediaPipe, OpenCV, Qwen3-8B 4bit, Ollama 또는 llama.cpp, Three.js, Rapier, Blender, (선택) CalculiX, OpenFOAM

각 모델과 오픈소스의 버전, 라이선스, 수정 여부를 `docs/licenses.md`에 기록한다. GPL 계열 도구는 배포 방식과 결합 형태를 별도 검토한다.

## 4. 핵심 처리 구조

웹캠 영상 → 손 영역 감지 → 손 랜드마크 추출 → 제스처 분류 → 좌표 안정화 → 3D 명령 변환 → 모델 선택·이동·회전 → 조립 규칙 검사 → AI 설명 및 피드백

## 5. Hand Tracking 모듈

관리 정보: 좌우 구분, 21개 랜드마크, 감지 신뢰도, 손가락별 펼침 상태, 엄지-검지 거리, 손바닥 방향, 손목 회전, 이전 프레임 대비 이동량, 제스처 유지 시간.

```json
{
  "handedness": "right",
  "confidence": 0.94,
  "landmarks": [],
  "palm_center": { "x": 0.51, "y": 0.42, "z": -0.08 },
  "pinch_distance": 0.04,
  "finger_states": { "thumb": true, "index": true, "middle": false, "ring": false, "pinky": false }
}
```

카메라 원본을 서버에 저장하지 않는다. 랜드마크 추출은 브라우저에서 처리한다.

## 6. Gesture Classifier

1단계 규칙 기반(PINCH/OPEN_PALM/FIST), 2단계 학습 기반(RF, SVM, MLP, LSTM/1D TCN; 시간 정보 포함).
평가: Accuracy, Precision, Recall, F1, 사용자별·조명별 정확도, 판정 지연시간. 두 방식 비교.

## 7. 제스처 안정화

비교: 이동 평균, EMA, One Euro Filter, Kalman Filter.
측정: 정지 상태 분산, 빠른 이동 지연, 잘못된 제스처 전환 횟수, 선택 유지 실패 횟수.
조건: 최소 유지 프레임, 신뢰도 임계값, 전환 대기시간, 선택/해제 히스테리시스, 연속 실행 방지.

## 8. Gesture Command Mapper

입력 `{gesture, position, confidence}` → 출력 `{command, target_id, world_position}`.
제스처 인식과 3D 조작을 직접 결합하지 않는다. 마우스·키보드·게임패드도 같은 명령을 쓴다.

## 9. 3D 공학 모델

```json
{
  "part_id": "gear-small-01", "name": "Small Drive Gear", "description": "", "mass": 0.2,
  "connection_points": [], "valid_parent_ids": [], "assembly_order": 2,
  "rotation_axis": "z", "gear_ratio": 0.5
}
```

시각 메시와 물리 충돌체를 분리한다.

## 10. Assembly Engine

역할: 선택, 이동, 결합 지점 탐색, 스냅 거리, 조립 순서, 방향, 잘못된 부품, 완료, 작동 가능 판정.
조립 판정은 LLM이 아닌 코드와 규칙으로 수행한다.

```json
{ "is_valid": false, "part_id": "gear-small-01", "target_slot": "shaft-02",
  "error_type": "WRONG_ORIENTATION", "expected_rotation": 90, "current_rotation": 0 }
```

## 11. 물리 시뮬레이션

Rapier: 충돌, 중력, 회전축, 관절, 기어 작동 시각화, 잘못 조립한 부품 움직임.
실제 응력·유동·피로 수명·누수량·안전 인증 수준 해석을 주장하지 않는다.

## 12–13. AI Engineering Tutor / 도구 호출

구조화된 컨텍스트만 전달:

```json
{ "selected_part": "gear-small-01", "assembly_state": "invalid", "detected_error": "WRONG_ORIENTATION",
  "completed_steps": [1, 2], "current_step": 3,
  "available_tools": ["get_part_info", "get_assembly_error", "get_mechanism_state"] }
```

도구: `get_part_info`, `get_assembly_state`, `get_assembly_error`, `run_visual_simulation`, `reset_assembly_step`.
LLM은 물리 결과를 생성하지 않고 도구 결과를 설명한다.

## 14. 공학 해석 확장 (MVP 이후)

CalculiX(보/브래킷 구조 해석), OpenFOAM(파이프 유동). AI는 출력 파일을 읽고 설명만 한다.
모든 해석 화면 문구: **교육용 시뮬레이션이며 실제 설계·제조·안전 판단에 사용할 수 없습니다.**

## 15. 화면 구성

1 연구실(웹캠, 손 추적 상태, 3D 모델, 현재 제스처, 안내) / 2 분해 모드 / 3 조립 모드 / 4 작동 모드 / 5 AI 튜터 / 6 실험 결과

## 16. 저장소 구조

```
holoforge-ai-lab/
├─ frontend/src/{components,features/{camera,hand-tracking,gestures,assembly,simulation,ai-tutor},three,services,types}
├─ frontend/tests/
├─ backend/app/{api,ai,tools,assembly,simulation,core}
├─ backend/tests/
├─ models/gearbox/{model.glb,parts.yaml,connections.yaml,assembly-steps.yaml}
├─ datasets/gestures/
├─ evals/{gesture-cases.jsonl,assembly-cases.jsonl,tool-call-cases.jsonl}
├─ docs/{architecture,gesture-spec,model-selection,experiments,decision-log,simulation-limitations,licenses}.md
├─ .github/workflows/ci.yml
├─ .env.example, LICENSE, README.md
```

## 17. AI 역량 검증

제스처 분류(규칙 vs RF/SVM vs 신경망 vs 시계열), 손 추적 안정화, AI 도구 호출(도구 선택률, 인자 정확도, 실행 성공률, 환각률, 사실 일치율), 사용자 조작(완료 시간, 선택 성공률, 오류 횟수, 재시도, 마우스 대비 시간).
기록 형식: 문제 → 기준 성능 → 원인 분석 → 개선 → 재측정 → 결과

## 18. OSS 역량 증명

자체 OSS 후보 `gesture-command-kit`: 제스처 상태 머신, 유지 시간 판정, 중복 실행 방지, 좌표 안정화, 명령 매핑, 신뢰도 임계값, 브라우저·Python 공통 이벤트 스키마.

## 19–20. MVP 포함 / 제외

포함: 웹캠 손 추적, 제스처 3~5개, 3D 기어박스, 부품 선택·이동·회전, 분해·조립, 오류 판정, 작동 시각화, AI 부품·오류 설명, 제스처 성능 측정.
제외: 실제 홀로그램, 복잡한 로봇, 산업 장비 제어, 정확한 응력·유동 해석, 다중 도메인, 음성, 다중 사용자, VR/AR, 모바일, CAD 업로드.

## 21. GitHub Actions

Ruff, pytest, TS 타입 검사, 프론트 빌드, 부품 YAML 스키마, 연결 지점 참조, 조립 순서, 제스처 이벤트 스키마, AI 도구 호출 스키마.
CI는 웹캠·GPU·LLM 불필요. 저장된 랜드마크와 mock adapter 사용. `permissions: contents: read`.

## 22. 완료 조건

1 카메라 권한 → 2 손 감지 → 3 현재 제스처 표시 → 4 집기로 부품 선택 → 5 손 이동으로 부품 이동 → 6 손 움직임으로 모델 회전 → 7 올바른 위치에서 조립 → 8 잘못된 위치 오류 표시 → 9 AI에게 부품 역할 질문 → 10 AI가 실제 데이터 조회 후 설명 → 11 작동 모드 회전 방향 확인 → 12 평가 스크립트로 정확도·지연시간 측정

## 23. 개발 원칙

게임 물리 ≠ 공학 해석 / 홀로그램 유사 ≠ 홀로그램 / 제스처와 3D 명령 분리 / 조립 판정은 규칙 엔진 / LLM은 도구로 상태 조회 / LLM이 공학 수치 생성 금지 / 카메라 원본 저장 금지 / 모델 호출은 교체 가능한 adapter / 모든 입력·AI 출력 스키마 검증 / 테스트 없이 완료 처리 금지 / 결정은 `decision-log.md`, 실험은 `experiments.md`
