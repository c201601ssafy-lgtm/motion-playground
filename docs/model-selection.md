# Model Selection

## 손 추적: MediaPipe Hand Landmarker

| 항목 | 내용 |
|---|---|
| 패키지 | `@mediapipe/tasks-vision` 1.1.0 (Apache-2.0) |
| 모델 | `hand_landmarker.task` float16 (Apache-2.0), Google CDN에서 로드 |
| 실행 | 브라우저 WebAssembly + WebGL(GPU 델리게이트, 실패 시 CPU) |
| 측정 | GPU headless Chrome 추적 32fps, 랜드마크 p50 11ms / p95 31ms |

선택 이유:
- 영상을 서버로 보내지 않고 브라우저 안에서 처리한다(프라이버시).
- 손 21점과 좌우 구분을 바로 준다.
- 설치가 필요 없다.

대안으로 OpenCV + 자체 모델, MediaPipe Python(서버 처리)을 검토했다. 둘 다 영상을 서버로 보내야 해서 제외했다.

## 제스처 분류: 규칙 기반 (1단계)

학습 데이터가 아직 없어 규칙 기반으로 시작한다(D-002, D-014). 실제 녹화 데이터를 모으면 RandomForest/SVM, 작은 MLP, 1D Temporal CNN과 비교한다(spec §6, `docs/experiments.md` E-03).

## AI 튜터: Qwen3-8B (Ollama)

| 항목 | 내용 |
|---|---|
| 모델 | `qwen3:8b` Q4_K_M (8.2B, 약 5.2GB), 컨텍스트 40960 |
| 라이선스 | Apache-2.0 |
| 런타임 | Ollama 0.40.2 (MIT), `/api/chat` + `tools` |
| 설정 | `think: false`, temperature 0.2, 도구 최대 4회 |
| 측정 | 질문당 p50 7.7s(첫 호출은 모델 로딩으로 20~40s), 도구 선택률 94% → P5-1 후 100% (E-01). VRAM 6GB GPU에선 CPU로 일부 넘어가 p50 18.7s |

선택 이유:
- 로컬에서 돈다: 학습자 질문이 외부로 나가지 않고, 데모장에 인터넷이 없어도 된다.
- 도구 호출(function calling)을 기본으로 지원한다.
- 8B 4bit라 6GB 이상 VRAM GPU나 Apple Silicon에서 돌릴 수 있다.
- 한국어 응답 품질이 같은 크기 모델 중 괜찮다.

하드웨어 요구:
- 권장: VRAM 8GB 이상 GPU (RTX 3060 이상) 또는 M1 Pro 이상.
- 최소: VRAM 6GB(일부 CPU 오프로드). CPU만 쓰면 답변당 수십 초 걸린다.

교체 가능성:
- 모든 호출은 `LLMAdapter`(`backend/app/ai/types.py`)를 거친다.
- `LLM_PROVIDER=mock|ollama`로 바꾼다. Ollama 연결이 실패하면 Mock으로 폴백하고 응답에 `degraded: true`를 단다.
- 더 큰 모델(qwen3:14b 등)은 `OLLAMA_MODEL`만 바꾸면 된다.

대안:

| 후보 | 장점 | 제외 이유 |
|---|---|---|
| 클라우드 API (Claude 등) | 도구 호출 정확도 높음 | 데모 네트워크 의존, 비용, 학습자 데이터 외부 전송 |
| Llama 3.1 8B | 도구 호출 지원 | 한국어 품질 |
| Qwen3-4B | 더 빠름 | 도구 선택 정확도가 더 낮을 가능성 (미측정) |
| llama.cpp 직접 | 의존성 적음 | Ollama가 모델 관리·도구 형식을 대신 해 줌 |

## 안전장치 (모델과 무관)

- 조립 판정·기구 계산은 규칙 엔진만 한다. LLM은 도구 결과를 설명만 한다.
- 답변 속 숫자가 도구 결과·질문에 없으면 `UNGROUNDED_NUMBER` 경고를 화면에 표시한다.
- 도구는 6개로 제한한다. 상태를 바꾸는 도구는 `reset_assembly_step` 하나뿐이고, 이벤트 로그에 `by: tutor`로 남는다.
