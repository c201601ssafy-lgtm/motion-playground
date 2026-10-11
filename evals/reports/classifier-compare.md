# Classifier Comparison — RandomForest vs 규칙 기반

- 데이터: synthetic (gesture-records-sample.jsonl)
- 프레임 1056개 (손 감지된 프레임만), 피험자 3명, 사용자 단위 분리(LOSO)

| 분류기 | Accuracy | Macro F1 |
|---|---|---|
| 규칙 기반 | 100.0% | 1.000 |
| RandomForest (200그루) | 99.9% | 0.999 |

| 시험 피험자 | 규칙 Acc | RF Acc | 학습 프레임 |
|---|---|---|---|
| syn01 | 100.0% | 100.0% | 704 |
| syn02 | 100.0% | 99.7% | 704 |
| syn03 | 100.0% | 100.0% | 704 |

| 조명 | 규칙 Acc | RF Acc |
|---|---|---|
| bright | 100.0% | 100.0% |
| dim | 100.0% | 99.7% |
| normal | 100.0% | 100.0% |

| 라벨 | 규칙 Recall | RF Recall |
|---|---|---|
| OPEN_PALM | 100.0% | 100.0% |
| PINCH | 100.0% | 99.6% |
| FIST | 100.0% | 100.0% |
| NONE | 100.0% | 100.0% |

> 합성 데이터 결과다. 합성 손은 규칙 분류기와 같은 가정(손가락 굽힘 각도)으로 만들어서 두 분류기 모두 점수가 높게 나온다. 실제 비교는 `#/record`로 모은 사람 데이터(`datasets/gestures/raw/`)로 다시 돌려야 한다.
