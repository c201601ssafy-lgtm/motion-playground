"""한국어 조사 선택."""

import re

_PAREN = re.compile(r"\s*\([^)]*\)\s*$")


def josa(word: str, pair: str) -> str:
    """받침 유무에 따라 조사를 붙인다. pair 예: "을/를", "이/가", "은/는", "과/와"."""
    with_final, without_final = pair.split("/")
    base = _PAREN.sub("", word) or word
    last = base[-1]
    if "가" <= last <= "힣":
        has_final = (ord(last) - ord("가")) % 28 != 0
        return word + (with_final if has_final else without_final)
    return word + without_final
