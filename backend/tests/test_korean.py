from app.core.korean import josa


def test_josa() -> None:
    assert josa("입력축", "을/를") == "입력축을"
    assert josa("상부 커버", "을/를") == "상부 커버를"
    assert josa("입력 기어 (12T)", "이/가") == "입력 기어 (12T)가"
    assert josa("베이스 플레이트", "은/는") == "베이스 플레이트는"
