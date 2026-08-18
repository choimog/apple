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


# -----------------------------------------------------------------------------
#  시리즈 권 번호 (『빛과 수의 시대 1』 의 1)
# -----------------------------------------------------------------------------
#  【2026-08-18 대표님 지시】
#    "매칭 시, 이런 식으로 두 도서가 시리즈로 도서로 유사한 제목과 넘버링을
#     가지고 있는 경우에는, 넘버링이 다르면 명확하게 다른 도서로 구분지어줄
#     필요가 있을 거거든?"
#
#  검토 화면에 올라와 있던 실제 짝입니다. 둘 다 **89점**이었습니다.
#
#     수상한생선의 진짜로 해부하는 과학책 1        (알라딘)
#     수상한 생선의 진짜로 해부하는 과학책 2 육상생물 (예스24)
#
#     빛과 수의 시대 1  (알라딘)
#     빛과 수의 시대 2  (교보)
#
#  저자·출판사·출간월이 전부 같고 제목도 78~79% 닮았습니다. 지금 규칙으로는
#  **묶는 것이 맞다고 나옵니다.** 번호만이 유일한 차이인데, 그 번호를
#  아무도 안 보고 있었습니다.
#
#  🚨 이 값은 **저장하지 않고 비교할 때 꺼냅니다.**
#     저장하는 값으로 만들면 다시 수집해야만 반영됩니다
#     (normalize_publisher 의 2026-08-12 설명과 같은 이유입니다).
#     이대로 두면 [도서 매칭] 한 번으로 이미 모아 둔 자료에도 적용됩니다.

_VOLUME_MAX = 200          # 이보다 크면 권 번호가 아니라 연도·수량입니다

# 세트 표기('전 7 권')는 set_volumes 가 따로 봅니다. 여기서는 빼고 셉니다.
_SET_MARK = re.compile(r"전\s*\d+\s*권")

# ① 번호 뒤에 권/부/편/화 가 붙은 것 — 가장 확실합니다. '슬램덩크 1권', '제 2권'
#    ⚠️ 뒤에 다른 글자가 이어지면 안 봅니다. '3부작' 은 권 번호가 아닙니다.
_VOL_MARKED = re.compile(r"(?:제\s*)?(\d{1,3})\s*[권부편화](?![0-9A-Za-z가-힣])")

# ② 홀로 떨어져 있는 번호 — '빛과 수의 시대 2', '… 과학책 2 육상생물'
#    ⚠️ '2판'·'3쇄' 처럼 뒤에 글자가 붙으면 안 봅니다(판형이지 권 번호가 아님).
_VOL_ALONE = re.compile(r"(?<![0-9A-Za-z가-힣])(\d{1,3})(?![0-9A-Za-z가-힣])")

# ③ 제목 끝에 띄어쓰기 없이 붙은 번호 — '빛과수의시대2'
#    ⚠️ 앞이 글자여야 합니다. '코스모스2024' 는 네 자리라 여기 안 걸립니다.
_VOL_TAIL = re.compile(r"(?<=[가-힣A-Za-z])(\d{1,3})$")


def extract_volume(title: str | None) -> int | None:
    """
    제목에 적힌 **시리즈 권 번호**를 꺼냅니다. 없으면 None.

        '빛과 수의 시대 2'                 → 2
        '수상한 생선의 … 과학책 2 육상생물' → 2
        '슬램덩크 1권'                     → 1
        '2026 원큐패스 …'                  → None  (맨 앞은 연도)
        '개정 3판'                         → None  (판형)
        '전 7 권 세트'                     → None  (set_volumes 가 봄)

    ⚠️ **없으면 None 입니다. 1 로 치지 않습니다.**
       1권은 번호를 안 붙이고 파는 일이 흔합니다. '모른다' 를 '1권' 으로
       바꾸면 『해리포터와 마법사의 돌』 과 『해리포터와 마법사의 돌 1』 이
       갈라집니다.
    """
    if not title:
        return None
    text = _SET_MARK.sub(" ", _nfkc(title)).strip()

    m = _VOL_MARKED.search(text)
    if m and 1 <= int(m.group(1)) <= _VOLUME_MAX:
        return int(m.group(1))

    for m in _VOL_ALONE.finditer(text):
        # 맨 앞의 번호는 연도(2026 수능특강)일 때가 많습니다. 안 봅니다.
        if not text[:m.start()].strip(" \t[(（【"):
            continue
        v = int(m.group(1))
        if 1 <= v <= _VOLUME_MAX:
            return v

    m = _VOL_TAIL.search(text)
    if m and 1 <= int(m.group(1)) <= _VOLUME_MAX:
        return int(m.group(1))
    return None


# 배지 바로 뒤에 이 글자가 오면 책 이름의 일부입니다 (『예약판매의 기술』).
_PARTICLES = frozenset("의을를은는이가에로와과도만서부터까지")

DEFAULT_TITLE_BADGES = ["예약판매", "예약 판매", "오늘출발", "오늘 출발"]


def strip_title_badges(text: str, badges: list[str] | None = None) -> str:
    """
    제목 **맨 앞**에 붙은 서점 배지 문구를 뗍니다.

    【2026-08-12 대표님 지적】
    "'예약판매' 라는 키워드를 제목에서 긁어오면 안 될텐데"

        문해내공  vs  예약판매문해내공     닮은 정도 0.55  → 다른 책으로 판정

    제목이 0.60 만큼도 안 닮으면 점수를 보기도 전에 갈라집니다.
    서점 화면의 배지가 제목 옆에 있어서 글자를 꺼낼 때 딸려 온 것입니다.

    ⚠️ **맨 앞에 있을 때만** 뗍니다.
    ⚠️ 뒤에 조사가 붙어 있으면 **안 뗍니다.** 『예약판매의 기술』 의
       '예약판매' 는 배지가 아니라 진짜 제목의 일부입니다.
       처음 만들었을 때 이걸 안 봐서 『의 기술』 이 됐습니다.
    ⚠️ 떼고 나서 아무것도 안 남으면 원래 값을 그대로 씁니다.
    """
    words = badges if badges is not None else DEFAULT_TITLE_BADGES
    out = (text or "").strip()
    changed = True
    while changed:                      # '[예약판매] 특가 제목' 처럼 겹칠 수 있음
        changed = False
        bare = out.lstrip("[(（【 \t")
        bracketed = bare is not out     # 괄호로 싸여 있으면 배지가 확실합니다
        for w in sorted(set(words), key=len, reverse=True):
            if not w or not bare.startswith(w):
                continue
            rest = bare[len(w):]
            # 조사로 이어지면 책 이름의 일부입니다. 건드리지 않습니다.
            if not bracketed and rest[:1] in _PARTICLES:
                break
            rest = rest.lstrip("]）】) -–—:：|·\t ")
            if len(rest.strip()) >= 2:  # 다 떼서 빈 제목이 되면 안 됩니다
                out = rest.strip()
                changed = True
            break
    return out or (text or "").strip()


def normalize_title(
    raw: str,
    edition_words: list[str] | None = None,
    edition_canonical: dict[str, str] | None = None,
    title_badges: list[str] | None = None,
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
    text = strip_title_badges(_nfkc(raw or "").strip(), title_badges)

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
    """
    '(주)문학동네' → '문학동네'

    ⚠️ 【2026-08-12 — 괄호를 여기서 떼지 않습니다】
    한때 '필름(Feelm)' 의 괄호를 여기서 떼어 봤습니다. 그런데 이 값은
    **수집할 때 계산해서 저장**하는 값이라 두 가지 문제가 있었습니다.

      ① 이미 모아 둔 자료에는 적용이 안 됩니다. 다시 수집해야만 바뀝니다.
      ② 괄호 안에 진짜 이름이 든 경우를 잃습니다.
           중앙books(중앙북스) → '중앙books'  ← 한글 이름이 사라짐
         그러면 '중앙북스' 와 오히려 더 멀어집니다 (0.37 → 0.24).

    그래서 **저장은 서점이 적은 대로 두고**, 비교할 때 괄호 안팎을
    각각 후보로 놓고 견줍니다. (common/match.py 의 publisher_variants)
    그러면 다시 수집하지 않아도 [도서 매칭] 한 번으로 반영됩니다.
    """
    if not raw:
        return None
    publisher_words = publisher_words or DEFAULT_PUBLISHER_WORDS
    text = _nfkc(raw)
    for w in sorted(set(publisher_words), key=len, reverse=True):
        text = text.replace(w, " ")
    text = re.sub(PUNCT, "", text)
    text = re.sub(r"\s+", "", text)
    return text.lower() or None

# -----------------------------------------------------------------------------
#  외국 이름의 된소리 흔들림 (카뮈 / 까뮈)
# -----------------------------------------------------------------------------
#  【2026-08-12 대표님 제보 — 『이방인』】
#      알베르 카뮈  vs  알베르 까뮈     닮은 정도 0.57
#
#  서점마다 외국 이름을 다르게 옮겨 적습니다. 흔한 짝입니다.
#      카뮈/까뮈 · 카프카/까프카 · 톨스토이/똘스또이 · 도스토옙스키/도스또옙스끼
#
#  된소리(ㄲㄸㅃㅉㅆ)를 거센소리·예사소리로 되돌린 값을 하나 더 만들어서,
#  그 값끼리도 견줍니다. **저장하는 값은 바꾸지 않습니다.** 비교할 때만
#  참고하는 보조 값입니다.
_HANGUL_BASE = 0xAC00
_HANGUL_LAST = 0xD7A3
#  초성 차례: ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ
#  ㄲ→ㅋ  ㄸ→ㅌ  ㅃ→ㅍ  ㅉ→ㅊ  ㅆ→ㅅ
_FORTIS_TO_PLAIN = {1: 15, 4: 16, 8: 17, 13: 14, 10: 9}


def fold_fortis(text: str | None) -> str | None:
    """된소리를 풀어 놓은 값. '알베르까뮈' → '알베르카뮈'"""
    if not text:
        return text
    out = []
    for ch in text:
        code = ord(ch)
        if _HANGUL_BASE <= code <= _HANGUL_LAST:
            off = code - _HANGUL_BASE
            lead, rest = divmod(off, 588)
            if lead in _FORTIS_TO_PLAIN:
                ch = chr(_HANGUL_BASE + _FORTIS_TO_PLAIN[lead] * 588 + rest)
        out.append(ch)
    return "".join(out)
