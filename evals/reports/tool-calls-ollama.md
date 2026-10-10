# Tool-call Evaluation — ollama

| 지표 | 값 |
|---|---|
| 케이스 | 16 |
| 도구 선택률 | 94% |
| 인자 정확도 | 83% |
| 실행 성공률 | 100% |
| 미근거 숫자 답변 비율 | 0% |
| 사실 일치율 | 90% |
| 지연 p50 / 최대 | 7697.2 / 20095.5 ms |
| 폴백(degraded) | 0 |

| 케이스 | 도구 | 선택 | 인자 | 사실 | 경고 |
|---|---|---|---|---|---|
| part-small-gear | get_part_info | ✅ | ✅ | ✅ |  |
| part-idler | get_part_info | ✅ | ✅ | ✅ |  |
| part-output-shaft | get_part_info | ✅ | ✅ | - |  |
| part-selected | get_part_info | ✅ | ✅ | - |  |
| dir-opposite | get_mechanism_state | ✅ | - | ✅ |  |
| ratio-up | get_mechanism_state | ✅ | - | ✅ |  |
| output-speed-60 | get_mechanism_state | ✅ | ✅ | ✅ |  |
| why-not-working-incomplete | get_assembly_error | ✅ | - | - |  |
| wrong-orientation | get_assembly_error | ✅ | - | ✅ |  |
| wrong-orientation-fix | get_assembly_error | ✅ | - | ✅ |  |
| missing-parent | get_assembly_error | ✅ | - | ✅ |  |
| progress | get_assembly_state | ✅ | - | ✅ |  |
| progress-complete | get_assembly_state | ✅ | - | ❌ |  |
| simulate | get_mechanism_state | ❌ | ❌ | - |  |
| simulate-incomplete | run_visual_simulation | ✅ | - | - |  |
| reset | reset_assembly_step | ✅ | - | - |  |
