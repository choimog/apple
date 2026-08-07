"""
표기 통일(정규화) — 서점마다 다르게 적힌 제목·저자·출판사를 비교 가능한 형태로.

【왜 필요한가요?】
같은 책인데 서점마다 이렇게 다르게 적혀 있습니다:
   교보  : "달러구트 꿈 백화점 (양장본)"
   예스24: "달러구트 꿈 백화점"
   알라딘: "달러구트 꿈 백화점 - 주문하신 꿈은 매진입니다"

이걸 그대로 비교하면 다른 책으로 보입니다. 그래서 비교 전에 표기를 통일합니다.
※ 원본 값은 서점별로 그대로 보존합니다. 정규화 값은 비교 전용입니다.

【규칙을 고치고 싶으면】
config/matching.yaml 의 단어 목록을 고치세요. 이 코드는 안 건드려도 됩니다.
"""

from __future__ import annotations

import re
import unicodedata

# 제목에서 떼어낼 에디션 표기 (config/matching.yaml 로 옮길 예정)
DEFAULT_EDITION_WORDS = [
    "개정판", "개정증보판", "증보판", "리커버", "리커버판", "양장본", "양장",
    "무선본", "반양장", "특별판", "한정판", "스페셜에디션", "합본",
    "초판본", "복간본", "개정신판", "완역본", "미니북", "북클럽",
]

# 저자에서 떼어낼 역할어
DEFAULT_ROLE_WORDS = [
    "지은이", "지음", "옮긴이", "옮김", "엮은이", "엮음", "글", "그림",
    "저자", "저", "역자", "역", "편저", "편", "감수", "번역", "사진", "만화",
]

# 출판사에서 떼어낼 표기
DEFAULT_PUBLISHER_WORDS = [
    "(주)", "주식회사", "㈜", "출판사", "출판그룹", "출판", "퍼블리싱",
]

# 대표 저자를 고를 때의 역할 우선순위 (앞일수록 우선)
DEFAULT_ROLE_PRIORITY = [
    "글", "지은이", "지음", "저", "그림", "엮", "편", "옮긴이", "옮김", "역",
]

# 제목에서 제거할 특수문자
PUNCT = r"[:：\-–—~〜,，.·・/／\\|｜!！?？'\"“”‘’`*+=＿_]"


def _nfkc(text: str) -> str:
    """전각/반각, 호환 문자를 표준형으로 통일"""
    return unicodedata.normalize("NFKC", text)


def split_brackets(title: str) -> tuple[str, list[str]]:
    """
    괄호/대괄호 안 내용을 분리합니다.
    "달러구트 꿈 백화점 (양장본)" → ("달러구트 꿈 백화점", ["양장본"])
    """
    inner: list[str] = []

    def grab(m: re.Match) -> str:
        inner.append(m.group(1).strip())
        return " "

    stripped = re.sub(r"[（(\[【]([^）)\]】]*)[）)\]】]", grab, title)
    return stripped.strip(), inner


def split_subtitle(title: str) -> tuple[str, str | None]:
    """
    콜론이나 대시 뒤쪽을 부제로 분리합니다.
    "달러구트 꿈 백화점 - 주문하신 꿈은 매진입니다"
       → ("달러구트 꿈 백화점", "주문하신 꿈은 매진입니다")
    """
    m = re.split(r"\s[-–—:：]\s", title, maxsplit=1)
    if len(m) == 2 and len(m[0].strip()) >= 2:
        return m[0].strip(), m[1].strip()
    return title.strip(), None


# 같은 뜻인데 다르게 적히는 판형 표기를 하나로 모읍니다.
# (이게 없으면 교보 '양장' 과 알라딘 '양장본' 이 다른 책으로 판정됩니다)
DEFAULT_EDITION_CANONICAL = {
    "양장": "양장본",
    "리커버판": "리커버",
}


def extract_editions(
    text: str,
    edition_words: list[str],
    canonical: dict[str, str] | None = None,
) -> list[str]:
    """
    제목/괄호 안에서 판형·에디션 표기를 찾아냅니다.

    긴 단어부터 찾아서 지워 나갑니다.
    그래야 '양장본' 을 찾은 뒤 그 안의 '양장' 을 또 찾는 일이 없습니다.
    """
    canonical = DEFAULT_EDITION_CANONICAL if canonical is None else canonical

    found: list[str] = []
    remaining = text
    for w in sorted(set(edition_words), key=len, reverse=True):
        if w in remaining:
            found.append(canonical.get(w, w))
            remaining = remaining.replace(w, " ")

    # "전7권", "전 7 권" 같은 세트 표기
    if re.search(r"전\s*\d+\s*권", text):
        found.append("전권세트")
    if "세트" in text:
        found.append("세트")
    return sorted(set(found))


def extract_set_volumes(text: str) -> int | None:
    """'전7권' → 7. 세트가 아니면 None."""
    m = re.search(r"전\s*(\d+)\s*권", text)
    return int(m.group(1)) if m else None


def normalize_title(
    raw: str,
    edition_words: list[str] | None = None,
    edition_canonical: dict[str, str] | None = None,
) -> dict:
    """
    제목을 비교용으로 정리합니다.

    돌려주는 값:
      core        : 핵심 제목 (비교에 쓰는 값)
      subtitle    : 분리된 부제
      editions    : ['개정판', '양장본'] 같은 에디션 표기
      set_volumes : '전7권'의 7 (세트가 아니면 None)
    """
    edition_words = edition_words or DEFAULT_EDITION_WORDS
    canonical = (DEFAULT_EDITION_CANONICAL if edition_canonical is None
                 else edition_canonical)
    text = _nfkc(raw or "").strip()

    editions = extract_editions(text, edition_words, canonical)
    set_volumes = extract_set_volumes(text)

    without_brackets, bracket_inner = split_brackets(text)
    for chunk in bracket_inner:
        editions.extend(extract_editions(chunk, edition_words, canonical))

    core, subtitle = split_subtitle(without_brackets)

    # 에디션 단어 자체를 제목에서 제거
    for w in sorted(set(edition_words), key=len, reverse=True):
        core = core.replace(w, " ")
    core = re.sub(r"전\s*\d+\s*권", " ", core)
    core = core.replace("세트", " ")

    # 특수문자·공백 제거, 소문자화
    core = re.sub(PUNCT, "", core)
    core = re.sub(r"\s+", "", core).lower()

    return {
        "core": core,
        "subtitle": subtitle,
        "editions": sorted(set(editions)),
        "set_volumes": set_volumes,
    }


def normalize_author(raw: str | None, role_words: list[str] | None = None) -> str | None:
    """'히가시노 게이고 (지은이)' → '히가시노게이고'"""
    if not raw:
        return None
    role_words = role_words or DEFAULT_ROLE_WORDS
    text = _nfkc(raw)
    text = re.sub(r"[（(\[][^）)\]]*[）)\]]", " ", text)  # 괄호 안 역할어 제거
    for w in sorted(set(role_words), key=len, reverse=True):
        text = text.replace(w, " ")
    text = re.sub(PUNCT, "", text)
    text = re.sub(r"\s+", "", text)
    return text.lower() or None


def normalize_publisher(
    raw: str | None, publisher_words: list[str] | None = None
) -> str | None:
    """'(주)문학동네' → '문학동네'"""
    if not raw:
        return None
    publisher_words = publisher_words or DEFAULT_PUBLISHER_WORDS
    text = _nfkc(raw)
    for w in sorted(set(publisher_words), key=len, reverse=True):
        text = text.replace(w, " ")
    text = re.sub(PUNCT, "", text)
    text = re.sub(r"\s+", "", text)
    return text.lower() or None
