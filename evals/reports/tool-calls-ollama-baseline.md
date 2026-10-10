# Tool-call Evaluation — ollama (기준: 도구 강제 전)

| 지표 | 값 |
|---|---|
| 케이스 | 16 |
| 도구 선택률 | 75% |
| 인자 정확도 | 50% |
| 실행 성공률 | 100% |
| 미근거 숫자 답변 비율 | 19% |
| 사실 일치율 | 90% |
| 지연 p50 / 최대 | 6860.6 / 15579.0 ms |
| 폴백(degraded) | 0 |

| 케이스 | 도구 | 선택 | 인자 | 사실 | 경고 |
|---|---|---|---|---|---|
| part-small-gear | get_part_info | ✅ | ✅ | ✅ |  |
| part-idler | (없음) | ❌ | ❌ | ✅ | NO_TOOLS_USED |
| part-output-shaft | (없음) | ❌ | ❌ | - | NO_TOOLS_USED |
| part-selected | (없음) | ❌ | ❌ | - | NO_TOOLS_USED |
| dir-opposite | get_mechanism_state | ✅ | - | ✅ |  |
| ratio-up | get_mechanism_state | ✅ | - | ✅ |  |
| output-speed-60 | get_mechanism_state | ✅ | ✅ | ✅ |  |
| why-not-working-incomplete | get_assembly_error | ✅ | - | - |  |
| wrong-orientation | get_assembly_error | ✅ | - | ✅ |  |
| wrong-orientation-fix | get_assembly_error | ✅ | - | ✅ |  |
| missing-parent | get_assembly_error | ✅ | - | ✅ |  |
| progress | (없음) | ❌ | - | ✅ | NO_TOOLS_USED, UNGROUNDED_NUMBER:2 |
| progress-complete | get_assembly_state | ✅ | - | ❌ |  |
| simulate | run_visual_simulation | ✅ | ✅ | - | UNGROUNDED_NUMBER:12.5 |
| simulate-incomplete | run_visual_simulation | ✅ | - | - |  |
| reset | reset_assembly_step | ✅ | - | - | UNGROUNDED_NUMBER:12 |
