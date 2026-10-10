# Phase 4 — AI 튜터(도구 호출) + 평가 스크립트 + 결과 화면

`docs/decision-log.md`(D-007, D-009)를 다시 읽어라. LLM은 공학 수치를 만들지 않는다. 모든 수치는 도구 결과에서 온다.

## 만들 것

1. **LLM 어댑터** `backend/app/ai/`
   - `LLMAdapter` Protocol, `OllamaAdapter`(httpx, `/api/chat`, `tools` 파라미터, 모델 `qwen3:8b`, `think: false`, 타임아웃·재시도), `MockAdapter`(질문 키워드 → 정해진 도구 호출 → 템플릿 답변; CI·데모 백업).
   - 환경변수 `LLM_PROVIDER=mock|ollama`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL` (`.env.example` 갱신). Ollama 연결 실패 시 mock 폴백 + 응답에 `degraded: true`.
2. **도구** `backend/app/tools/`: D-007의 6개. 각각 Pydantic 입력/출력 모델. 레지스트리에서 JSON Schema 자동 생성 → `schemas/tool-calls.schema.json` 내보내기 스크립트. 도구는 세션의 AssemblyEngine만 사용.
3. **튜터 루프** `POST /api/sessions/{id}/tutor` `{question, selected_part?}`
   - 시스템 프롬프트(한국어, 초중급 학습자 대상, 짧게, 수치는 도구 결과만 인용, 모르면 모른다고) + spec §12 구조화 컨텍스트.
   - 최대 4회 도구 호출. 잘못된 도구명/인자는 오류를 모델에 돌려줌.
   - 응답 `{answer, used_tools:[{name,args,result}], cited_values, warnings[], actions[], degraded}`. 답변 속 숫자가 도구 결과에 없으면 `warnings`에 `UNGROUNDED_NUMBER`.
   - `run_visual_simulation` 호출 시 `actions`로 프론트 작동 모드 애니메이션 트리거.
4. **튜터 화면**: 선택 부품 칩, 질문 입력 + 예시 질문 5개(spec §12), 답변, 접을 수 있는 "도구 호출 내역", 관련 개념 태그. 조립 오류 직후 "왜 틀렸어?" 원클릭 버튼.
5. **평가**
   - `backend/scripts/eval_gestures.py`: `datasets/gestures/raw/*.jsonl`(없으면 `evals/gesture-cases.jsonl`) → 규칙 분류기+상태 머신 → Accuracy, Macro F1, 라벨별 P/R, 혼동행렬, 사용자별·조명별 표, 필터별 정지 분산·오전환 수. Markdown + JSON 리포트를 `evals/reports/`에.
   - `backend/scripts/eval_tool_calls.py`: `evals/tool-call-cases.jsonl`(질문, 세션 시나리오, 기대 도구·인자, 정답 수치) 15개 이상 → 도구 선택률, 인자 정확도, 실행 성공률, 미근거 숫자 비율, 사실 일치율. `--provider mock|ollama`.
   - (선택) `backend/scripts/train_classifier.py`: scikit-learn RandomForest, leave-one-subject-out, 규칙 기반과 비교표. 데이터 없으면 건너뜀.
6. **결과 화면** `/results`: 프론트 지연 p50/p95(Phase 2 계측), 세션 조립 시간·오류 횟수·재시도(Phase 3 로그), 최신 평가 리포트 JSON. JSON 내보내기.
7. **CI**: mock 프로바이더로 튜터 API 테스트, 도구 스키마 검증, `eval_tool_calls.py --provider mock`, `eval_gestures.py` 스모크 실행.
8. **문서**
   - `docs/experiments.md`: 실험 2개 이상, "문제 → 기준 성능 → 원인 분석 → 개선 → 재측정 → 결과" 형식(예: 필터 없음 vs One Euro, 규칙 vs RF, mock vs qwen3 도구 선택률). 미측정 값은 빈칸 + 측정 방법.
   - `docs/model-selection.md`: Qwen3-8B 선택 이유, 대안, 하드웨어 요구.
   - `docs/licenses.md` 갱신(MediaPipe, Qwen3, Ollama 등 버전·라이선스·수정 여부).
   - README: 전체 실행 방법(Ollama 포함/미포함), 데모 시나리오, 완료 조건 체크리스트.

## 완료 조건

- spec §22의 1~12번 전부 확인. 항목별 검증 방법(자동 테스트/수동)을 표로 정리.
- `LLM_PROVIDER=mock`으로 CI 통과. 로컬에 Ollama 있으면 실제 질문 3개 돌려서 답변과 도구 호출 내역 보여줘.
- 남은 위험 + MVP 이후 로드맵(양손 제스처, 학습 분류기, Rapier 연출, GLB 에셋, CalculiX) 정리.
