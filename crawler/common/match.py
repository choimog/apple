"""
같은 책 찾아내기(매칭) — 점수 계산 부분.

【이 파일이 하는 일】
서점 A 의 책 1권과 서점 B 의 책 1권을 놓고
"이 둘이 같은 책인가?" 를 100점 만점으로 판정합니다.

규칙 설명은 docs/matching-rules.md 에, 숫자는 config/matching.yaml 에 있습니다.
이 파일은 그 규칙을 그대로 옮긴 것입니다.

※ 값이 비어 있으면 0점입니다. "모르니까 맞다고 치자" 는 하지 않습니다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher

from .normalize import fold_fortis


# -----------------------------------------------------------------------------
#  비교 대상 한 권
# -----------------------------------------------------------------------------
@dataclass
class Candidate:
    """store_books 표의 한 행에서 비교에 필요한 것만 뽑아 담은 것."""
    id: int
    store_id: int
    norm_title: str
    norm_author: str | None
    norm_publisher: str | None
    pub_ym: str | None
    isbn13: str | None
    edition_tags: list[str] = field(default_factory=list)
    set_volumes: int | None = None
    # 【2026-08-11 대표님 지시】
    # "정가가 다르면 확실히 다른 도서가 되는 거고,
    #  정가가 같다는 전제 하에 지금의 규칙은 조금 수정해서 조정할 필요가 있다"
    list_price: int | None = None
    norm_subtitle: str | None = None


# -----------------------------------------------------------------------------
#  글자 닮은 정도 재기
# -----------------------------------------------------------------------------
def _bigrams(text: str) -> set[str]:
    """'달러구트' → {'달러','러구','구트'}. 두 글자씩 끊습니다."""
    return {text[i:i + 2] for i in range(len(text) - 1)} or {text}


def similarity(a: str | None, b: str | None) -> float:
    """
    두 글자열이 얼마나 닮았는지 0.0 ~ 1.0 으로 돌려줍니다.

    두 가지 방법의 평균을 씁니다. 한쪽만 쓰면 잘 속기 때문입니다.
      1) 순서까지 보는 비교  (SequenceMatcher)
      2) 두 글자씩 끊어서 겹치는 비율 (bigram Jaccard)
    """
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0

    seq = SequenceMatcher(None, a, b).ratio()

    ba, bb = _bigrams(a), _bigrams(b)
    jac = len(ba & bb) / len(ba | bb) if (ba | bb) else 0.0

    return (seq + jac) / 2


_PAREN = re.compile(r"[(（\[［{]([^)）\]］}]*)[)）\]］}]")


def publisher_variants(name: str | None) -> set[str]:
    """
    출판사 이름의 '같은 뜻인 표기' 후보들.

    【2026-08-12 대표님 제보】
        필름(Feelm)      vs  필름     닮은 정도 0.24  → 다른 출판사로 판정
        윌북(willbook)   vs  윌북     0.19
        (주)YBM(와이비엠) vs  YBM     0.38
        중앙books(중앙북스) vs 중앙북스  0.37

    서점마다 괄호 부기를 붙이기도 하고 안 붙이기도 합니다.
    출판사가 0.80 만큼 안 닮으면 **점수를 보기도 전에 다른 책**이라
    이것만으로 갈라지고 있었습니다.

    ⚠️ 【왜 괄호를 지우지 않고 후보를 여럿 두나요?】
    한때 저장할 때 괄호를 떼어 봤는데 두 가지가 걸렸습니다.
      ① 저장값은 **수집할 때** 정해지므로, 이미 모아 둔 자료에는
         적용이 안 됩니다. 다시 수집해야만 바뀝니다.
      ② 괄호 안에 진짜 이름이 든 경우를 잃습니다.
           중앙books(중앙북스) → '중앙books'  ← 한글 이름이 사라져
           '중앙북스' 와 오히려 더 멀어집니다 (0.37 → 0.24).

    그래서 **괄호 안과 밖을 둘 다 후보로** 놓고, 하나라도 맞으면
    같은 출판사로 봅니다. 비교할 때 계산하므로 다시 수집할 필요가
    없고, 어느 쪽에 진짜 이름이 있든 잡힙니다.

        필름(feelm)        → {필름feelm, 필름, feelm}
        중앙books(중앙북스) → {중앙books중앙북스, 중앙books, 중앙북스}
        ybm(와이비엠)       → {ybm와이비엠, ybm, 와이비엠}
    """
    if not name:
        return set()
    out = {name}
    inner = _PAREN.findall(name)
    outer = _PAREN.sub("", name).strip()
    if outer:
        out.add(outer)
    for chunk in inner:
        chunk = chunk.strip()
        if chunk:
            out.add(chunk)
    return {v for v in out if v}


# -----------------------------------------------------------------------------
#  사람이 '이 둘은 같은 출판사' 라고 정해 둔 것 (2026-08-12 대표님 요청)
# -----------------------------------------------------------------------------
#  "한빛life 랑 한빛라이프처럼, 서점마다 출판사를 표기하는 명칭이 조금씩
#   다른데 이것도 다 규칙화하기 어려울 것 같아서."
#
#  맞습니다. 한글/영문 표기 차이는 글자로는 절대 못 잡습니다
#  (한빛life ↔ 한빛라이프 는 닮은 정도 0.29).
#
#  🚨 【왜 여기 한 군데에만 두나요?】
#  출판사가 같은지 보는 자리가 여러 군데인데, 오늘(2026-08-12) 그것들을
#  전부 이 함수 하나로 모았습니다. 그래서 여기만 고치면
#    · 두 권을 붙일지 정할 때 (compare)
#    · 무리에서 갈라낼 때 (publisher_sides → run_match)
#    · 묶은 결과를 검사할 때 (verify_publishers)
#  세 군데가 **자동으로 같이** 바뀝니다.
#  잣대를 따로 만들면 오늘 두 번 겪은 사고("멀쩡한 묶음을 잘못됐다고
#  신고하고 매칭이 멈춤")가 또 납니다. 절대 나누지 마세요.
#
#  값은 프로그램이 시작할 때 데이터베이스에서 한 번 읽어 넣습니다
#  (crawler/run_match.py · crawler/verify_publishers.py).
# -----------------------------------------------------------------------------
_ALIAS_OF: dict[str, str] = {}      # 정규화한 이름 → 그 무리의 대표 이름


def set_publisher_aliases(mapping: dict[str, str] | None) -> int:
    """
    '이 이름은 저 출판사와 같다' 표를 넣습니다. 넣은 개수를 돌려줍니다.
    비우려면 None 또는 빈 표를 넣으세요.
    """
    _ALIAS_OF.clear()
    for name, canonical in (mapping or {}).items():
        if name and canonical:
            _ALIAS_OF[name.strip()] = canonical.strip()
    return len(_ALIAS_OF)


def publisher_aliases() -> dict[str, str]:
    """지금 들어 있는 표 (시험·화면 확인용)."""
    return dict(_ALIAS_OF)


def _alias_group(variants: set[str]) -> set[str]:
    """이 이름의 후보들이 속한 '사람이 정한 무리' 대표들."""
    return {_ALIAS_OF[v] for v in variants if v in _ALIAS_OF}


def publisher_similarity(a: str | None, b: str | None) -> float:
    """
    두 출판사가 얼마나 닮았는지. 괄호 안팎 후보끼리 다 견주고 가장 높은 값.

    사람이 '같은 곳' 이라고 정해 둔 짝은 글자와 상관없이 1.0 입니다.
    """
    va, vb = publisher_variants(a), publisher_variants(b)
    if not va or not vb:
        return 0.0
    if va & vb:                     # 후보가 하나라도 똑같으면 같은 출판사
        return 1.0
    if _ALIAS_OF:
        # 🚨 사람이 정한 것이 글자보다 먼저입니다.
        ga, gb = _alias_group(va), _alias_group(vb)
        if ga & gb:
            return 1.0
    return max(similarity(x, y) for x in va for y in vb)


def publisher_sides(names: list[str], floor: float) -> list[list[int]]:
    """
    출판사 이름 여러 개를 **'같은 출판사' 끼리 편으로** 나눕니다.
    돌려주는 값은 이름의 자리번호(0,1,2…) 묶음입니다.

    【왜 '두 개씩 전부' 가 아니라 '이어지면 한 편' 인가요 — 2026-08-12】

    한 책에 이렇게 세 가지 표기가 들어옵니다.

        교보문고  YBM(와이비엠)
        예스24    YBM
        알라딘    와이비엠

    'YBM' 과 '와이비엠' 만 떼어 놓고 글자로 재면 **0.00** 입니다.
    한글과 영문이라 겹치는 글자가 하나도 없습니다. 그래서 '두 개씩
    전부 닮아야 한다' 로 재면 이 책은 잘못 묶인 것이 됩니다.

    하지만 가운데 'YBM(와이비엠)' 이 **두 이름이 같은 곳이라고 스스로
    밝히고 있습니다.** 이건 근거 없는 우회가 아니라 서점이 적어 준
    증거입니다. 그래서 이어지면 한 편으로 봅니다.

        YBM(와이비엠) ─ YBM        (괄호 밖이 같음)
        YBM(와이비엠) ─ 와이비엠    (괄호 안이 같음)
        → 세 개가 한 편

    ⚠️ '출판사를 아예 모르는 책' 을 다리로 삼는 우회와는 다릅니다.
       그건 여전히 막습니다 (모르는 책은 애초에 이 목록에 안 들어옵니다).
       민음사 / 문학동네 는 이어 줄 이름이 없으니 그대로 두 편입니다.

    ※ 이 함수를 세 군데(붙일 때·갈라낼 때·검사할 때)가 같이 씁니다.
       한 군데만 다르게 세면 붙였다 뗐다를 매일 반복합니다.
    """
    parent = list(range(len(names)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for x in range(len(names)):
        for y in range(x + 1, len(names)):
            if publisher_similarity(names[x], names[y]) >= floor:
                rx, ry = find(x), find(y)
                if rx != ry:
                    parent[ry] = rx

    sides: dict[int, list[int]] = {}
    for i in range(len(names)):
        sides.setdefault(find(i), []).append(i)
    return list(sides.values())


def name_similarity(a: str | None, b: str | None) -> float:
    """
    사람 이름끼리 견줍니다. 된소리를 푼 값끼리도 견줘서 더 높은 쪽을 씁니다.

    【2026-08-12 대표님 제보 — 『이방인』】
        알베르 카뮈  vs  알베르 까뮈     그냥 견주면 0.57 (기준 0.80 미달)

    서점마다 외국 이름을 다르게 옮겨 적습니다. 사람이 보면 같은 사람인데
    글자만 견주면 남남이 됩니다. 흔한 짝: 카뮈/까뮈 · 톨스토이/똘스또이
    """
    plain = similarity(a, b)
    folded = similarity(fold_fortis(a), fold_fortis(b))
    return max(plain, folded)


def same_name(a: str | None, b: str | None) -> bool:
    """된소리 표기만 다른 것도 같은 이름으로 봅니다."""
    if not a or not b:
        return False
    return a == b or fold_fortis(a) == fold_fortis(b)


def _months_apart(a: str | None, b: str | None) -> int | None:
    """'2026-07' 과 '2026-09' 는 2개월 차이. 형식이 이상하면 None."""
    if not a or not b:
        return None
    try:
        ya, ma = int(a[:4]), int(a[5:7])
        yb, mb = int(b[:4]), int(b[5:7])
    except (ValueError, IndexError):
        return None
    return abs((ya * 12 + ma) - (yb * 12 + mb))


# -----------------------------------------------------------------------------
#  판정 결과
# -----------------------------------------------------------------------------
@dataclass
class MatchResult:
    score: int                 # 0 ~ 100
    decision: str              # 'auto_high' | 'auto_low' | 'rejected'
    reasons: dict              # 왜 이렇게 나왔는지 (DB 에 근거로 저장)

    @property
    def is_same_book(self) -> bool:
        return self.decision in ("auto_high", "auto_low")


def _reject(why: str, detail: dict | None = None) -> MatchResult:
    return MatchResult(
        score=0,
        decision="rejected",
        reasons={"rejected_by": why, **(detail or {})},
    )


# -----------------------------------------------------------------------------
#  본체 — 두 권을 비교
# -----------------------------------------------------------------------------
def compare(a: Candidate, b: Candidate, cfg: dict) -> MatchResult:
    """
    책 두 권을 비교해서 같은 책인지 판정합니다.

    순서:
      1단계  절대 같을 수 없는 조건인가  → 즉시 거부
      2단계  점수를 매긴다 (100점 만점)
      3단계  점수에 따라 자동병합 / 검토대기 / 거부
    """
    w = cfg["weights"]
    p = cfg["partial"]
    th = cfg["thresholds"]

    # =========================================================================
    #  1단계 — 점수와 상관없이 '다른 책' 인 조건
    # =========================================================================

    # 같은 서점 안의 두 상품은 절대 묶지 않습니다.
    # 한 서점이 같은 책을 두 번 올릴 리 없고, 올렸다면 실제로 다른 판형입니다.
    if a.store_id == b.store_id:
        return _reject("같은 서점 안의 두 상품")

    # 세트 권수가 다르면 다른 책 (전7권 vs 단권)
    # ※ 에디션 검사보다 먼저 봅니다. '세트' 도 에디션 표기에 들어가기 때문에,
    #   순서가 반대면 "에디션이 다름" 이라는 덜 정확한 이유가 기록됩니다.
    if (a.set_volumes or 0) != (b.set_volumes or 0):
        return _reject("세트 권수가 다름", {
            "a": a.set_volumes, "b": b.set_volumes,
        })

    # -------------------------------------------------------------------------
    #  정가가 다르면 다른 책입니다 — 2026-08-11 대표님 지시
    #
    #  도서정가제상 정가는 출판사가 정한 **하나의 값**입니다. 3사가 같아야
    #  정상이고, 다르면 판형·개정판이 다른 별개 상품입니다.
    #  ⚠️ 한쪽이라도 모르면 거부하지 않습니다. '모른다' 를 '다르다' 로
    #     바꾸면 값이 아직 없는 책이 전부 갈라집니다.
    #     (정가는 2026-08-11 부터 걷기 시작해서, 그 전 자료에는 없습니다)
    #
    #  ⚠️ 【2026-08-11 저녁 — 확인 안 된 서점의 정가로는 갈라내지 않습니다】
    #  교보 정가를 알라딘과 대조해 보니 2,663쌍 중 132쌍(5%)이 어긋났습니다.
    #      교보 2,918,000원  vs  알라딘 18,000원   ('29' + '18,000' 이 이어붙음)
    #  원인은 고쳤지만(stores/base.py 의 box_text), **고친 값이 실제로
    #  맞는지는 다음 수집이 돌아야 알 수 있습니다.** 그때까지 교보 정가로
    #  짝을 갈라내면 멀쩡한 짝이 계속 갈라집니다.
    #  확인이 끝나면 config/matching.yaml 의 price_hard_stores 에 1 을
    #  넣으시면 됩니다. (점수 계산에는 계속 씁니다. 확정 거부만 안 합니다)
    # -------------------------------------------------------------------------
    same_price = None                    # None = 한쪽이라도 모름
    if a.list_price and b.list_price:
        same_price = a.list_price == b.list_price
        trusted = set(th.get("price_hard_stores") or [])
        both_trusted = a.store_id in trusted and b.store_id in trusted
        if not same_price and th.get("price_hard", True) and both_trusted:
            return _reject("정가가 다름", {"a": a.list_price, "b": b.list_price})

    # -------------------------------------------------------------------------
    #  '같은 책일 가능성이 아주 높은 상태' 인지 봅니다 — 2026-08-11
    #
    #  대표님이 주신 예시들입니다.
    #    원소 원정대            / 원소 원정대: 118개 캐릭터로 마스터하는…
    #    오디세이아 (영화 원작) / 오디세이아(고대 그리스어 완역본)
    #    날개 : 이상 소설전집   / 날개
    #
    #  전부 저자·출판사·출간월·정가가 같고 **제목의 꾸밈말만** 다릅니다.
    #  이럴 때는 제목 규칙을 조금 풀어 줍니다. 대신 조건이 하나라도
    #  어긋나면 절대 풀지 않습니다.
    # -------------------------------------------------------------------------
    relax = (
        a.norm_author and b.norm_author and a.norm_author == b.norm_author
        and a.norm_publisher and b.norm_publisher
        and publisher_similarity(a.norm_publisher, b.norm_publisher) >= 1.0
        and a.pub_ym and b.pub_ym and a.pub_ym == b.pub_ym
        and same_price is not False          # 정가를 알면 같아야 함
    )

    # 에디션 표기가 다르면 다른 책 (개정판/리커버/양장본은 별도 도서)
    #
    # ⚠️ 다만 '완역본' 처럼 **판형이 아니라 내용을 설명하는 말**은, 위 조건이
    #    전부 같으면 무시합니다. 『오디세이아(고대 그리스어 완역본)』이
    #    이것 때문에 갈라져 있었습니다.
    #    개정판·양장본 같은 진짜 판형 차이는 여전히 갈라냅니다.
    soft = set(th.get("edition_soft_words") or [])
    ed_a, ed_b = set(a.edition_tags or []), set(b.edition_tags or [])
    if ed_a != ed_b:
        if not (relax and (ed_a ^ ed_b) <= soft):
            return _reject("에디션 표기가 다름", {
                "a": sorted(ed_a), "b": sorted(ed_b),
            })

    # 제목이 이 정도로 다르면 나머지가 다 맞아도 다른 책
    title_sim = similarity(a.norm_title, b.norm_title)

    # 한쪽 제목이 다른 쪽의 **앞부분**이면 부제가 붙은 것뿐입니다.
    #   '원소원정대' ⊂ '원소원정대118개캐릭터로…'
    # 위 조건이 전부 같을 때만 인정합니다.
    prefix = False
    if relax and a.norm_title and b.norm_title:
        x, y = sorted((a.norm_title, b.norm_title), key=len)
        # 너무 짧은 제목은 우연히 겹칩니다 ('밤' ⊂ '밤의 여행자들')
        if len(x) >= th.get("prefix_min_len", 4) and y.startswith(x):
            prefix = True
            title_sim = max(title_sim, th.get("prefix_title_sim", 0.95))

    if title_sim < th["title_hard_floor"]:
        return _reject("제목이 너무 다름", {"title_sim": round(title_sim, 3)})

    # -------------------------------------------------------------------------
    # 출판사가 다르면 다른 책입니다. 점수와 상관없이 즉시 거부합니다.
    #
    # 【왜 이 규칙이 생겼나요? — 2026-08-08 대표님 지적】
    # 민음사·서정시학·다산북스·문학동네의 '싯다르타' 가 한 권으로 뭉쳐
    # 있었습니다. 같은 원작이어도 판권·번역·정가가 다른 별개의 상품입니다.
    # 출판 마케팅에서 이 둘을 섞으면 자료 자체가 쓸모없어집니다.
    #
    # 예전에는 출판사를 '15점짜리 가산점' 으로만 봤습니다. 그래서
    #   제목 50 + 저자 25 = 75점  →  묶는 기준(65점)을 넘어 버렸습니다.
    # 출판사가 완전히 달라도 묶였다는 뜻입니다.
    #
    # 이제 1단계(즉시 거부)로 올립니다. 점수로는 절대 뒤집을 수 없습니다.
    #
    # ※ '민음사' 와 '(주)민음사' 처럼 표기만 다른 경우까지 갈라놓으면 안 되므로,
    #   표기를 정리한 뒤 닮은 정도로 비교합니다. (publisher_hard_floor)
    # -------------------------------------------------------------------------
    publisher_known = bool(a.norm_publisher and b.norm_publisher)
    if publisher_known:
        pub_sim = publisher_similarity(a.norm_publisher, b.norm_publisher)
        if pub_sim < th.get("publisher_hard_floor", 0.80):
            return _reject("출판사가 다름", {
                "a": a.norm_publisher,
                "b": b.norm_publisher,
                "publisher_sim": round(pub_sim, 3),
            })

    # -------------------------------------------------------------------------
    #  출간월(배본일)이 다르면 다른 책입니다 — 2026-08-09 대표님 지시
    #
    #  "적어도 배본일이 다르면 아예 다른 도서로 잡아줘."
    #
    #  예전에는 출간월을 10점짜리 가산점으로만 봤습니다. 그래서
    #    제목 50 + 저자 25 = 75점  →  묶는 기준(65점)을 넘어 버립니다.
    #  출간월이 몇 년씩 차이 나도 묶였다는 뜻입니다.
    #  개정판·재출간은 판권과 내용이 다른 별개의 상품입니다.
    #
    #  ⚠️ 다만 '한 달 차이' 까지 갈라놓으면 안 됩니다.
    #     서점마다 배본일을 적는 기준이 조금씩 다릅니다 (인쇄일/출고일/판매일).
    #     같은 책인데 교보는 2026-01, 예스24 는 2026-02 로 적는 일이 흔합니다.
    #     그래서 pub_ym_near_months(기본 1개월) 까지는 같은 것으로 봅니다.
    #     완전히 딱 맞는 것만 인정하시려면 그 값을 0 으로 바꾸세요.
    #
    #  ⚠️ 한쪽이라도 출간월을 모르면 **거부하지 않습니다.**
    #     '모른다' 를 '다르다' 로 바꾸면 값이 빈 서점의 책이 전부 갈라집니다.
    #     모르는 것은 모르는 대로 두고, 점수에서 0점을 줍니다.
    # -------------------------------------------------------------------------
    #  【2026-08-12 — 나머지가 전부 같으면 출간월 차이를 넘어갑니다】
    #  대표님이 안 묶인다고 알려주신 책들:
    #
    #     데미안        민음사 8,000원    2000-12  vs  2009-01
    #     이방인        민음사 10,000원   2019-09  vs  2011-03
    #     돈의 심리학   인플루엔셜 24,800원 2026-01 vs 2021-01
    #     100일 기도    생활성서사 16,000원 2019-07 vs 2008-05
    #
    #  같은 책의 **다른 쇄(刷)** 를 서점마다 다른 날짜로 적은 것입니다.
    #  한 곳은 최초 출간일, 다른 곳은 최근 인쇄일을 씁니다.
    #
    #  '한 달만 달라도 다른 책' 은 2026-08-09 대표님 지시인데, 그때는
    #  **정가를 모르던 때**였습니다. 이제 정가라는 더 강한 근거가 있습니다.
    #  개정판·양장본은 정가가 바뀝니다. 제목·저자·출판사·정가가 **네 개 다**
    #  같으면 판형이 다를 수가 없습니다.
    #
    #  ⚠️ 조건이 아주 좁습니다. 하나라도 비어 있으면 적용 안 됩니다.
    #     · 정가가 양쪽에 다 있고 **같아야** 함 (한쪽만 알면 안 됨)
    #     · 저자·출판사가 양쪽에 다 있고 **완전히 같아야** 함
    #     · 핵심 제목이 완전히 같아야 함
    #     · 판형 표기(개정판·양장본)는 위에서 이미 걸러졌음
    #  끄시려면 config/matching.yaml 의 pub_ym_soft_when_identical 을 false 로.
    ym_gap = _months_apart(a.pub_ym, b.pub_ym)
    if ym_gap is not None and th.get("pub_ym_hard", True):
        allow = p.get("pub_ym_near_months", 1)
        identical = (
            th.get("pub_ym_soft_when_identical", True)
            and same_price is True                       # 정가가 양쪽에 있고 같음
            and same_name(a.norm_author, b.norm_author)
            and a.norm_publisher and b.norm_publisher
            and publisher_similarity(a.norm_publisher, b.norm_publisher) >= 1.0
            and a.norm_title and a.norm_title == b.norm_title
        )
        if ym_gap > allow and not identical:
            return _reject("출간월(배본일)이 다름", {
                "a": a.pub_ym,
                "b": b.pub_ym,
                "months_apart": ym_gap,
                "allowed": allow,
            })

    # =========================================================================
    #  2단계 — 점수 매기기
    # =========================================================================
    reasons: dict = {"title_sim": round(title_sim, 3)}
    # 왜 그렇게 봤는지 화면에 그대로 보여 주기 위해 남깁니다
    if same_price is True:
        reasons["price"] = f"same({a.list_price:,})"
    elif same_price is None:
        reasons["price"] = "missing"
    if prefix:
        reasons["title_prefix"] = "부제만 붙음"
    score = title_sim * w["title"]

    # --- 저자 ---
    if a.norm_author and b.norm_author:
        # 된소리 표기만 다른 것(카뮈/까뮈)도 같은 이름으로 봅니다.
        if same_name(a.norm_author, b.norm_author):
            score += w["author"]
            reasons["author"] = (
                "exact" if a.norm_author == b.norm_author else "exact(표기만 다름)"
            )
        else:
            sim = name_similarity(a.norm_author, b.norm_author)
            if sim >= p["author_similar_at"]:
                score += p["author_similar_score"]
                reasons["author"] = f"similar({sim:.2f})"
            else:
                reasons["author"] = f"different({sim:.2f})"
    else:
        # 한쪽이라도 값이 없으면 0점. 추정하지 않습니다.
        reasons["author"] = "missing"

    # --- 출판사 ---
    if a.norm_publisher and b.norm_publisher:
        if publisher_similarity(a.norm_publisher, b.norm_publisher) >= 1.0:
            score += w["publisher"]
            reasons["publisher"] = "exact"
        else:
            sim = publisher_similarity(a.norm_publisher, b.norm_publisher)
            if sim >= p["publisher_similar_at"]:
                score += p["publisher_similar_score"]
                reasons["publisher"] = f"similar({sim:.2f})"
            else:
                reasons["publisher"] = f"different({sim:.2f})"
    else:
        reasons["publisher"] = "missing"

    # --- 출간월 --- (위 1단계에서 이미 잰 값을 그대로 씁니다)
    gap = ym_gap
    if gap is None:
        reasons["pub_ym"] = "missing"
    elif gap == 0:
        score += w["pub_ym"]
        reasons["pub_ym"] = "exact"
    elif gap <= p["pub_ym_near_months"]:
        score += p["pub_ym_near_score"]
        reasons["pub_ym"] = f"near({gap}개월)"
    else:
        reasons["pub_ym"] = f"different({gap}개월)"

    final = int(round(score))
    reasons["score"] = final

    # =========================================================================
    #  3단계 — 점수로 판정
    # =========================================================================
    # 출판사를 한쪽이라도 모르면, '다르지 않다' 고 말할 수 없습니다.
    # 이럴 때는 낮은 기준(auto_low)으로 묶지 않고 높은 기준을 요구합니다.
    # (제목·저자만 같아도 다른 출판사의 같은 원작일 수 있기 때문입니다)
    if not publisher_known and th.get("publisher_unknown_needs_high", True):
        reasons["publisher_unknown"] = True
        decision = "auto_high" if final >= th["auto_high"] else "rejected"
        reasons["note"] = "출판사를 알 수 없어 더 엄격한 기준을 적용함"
        return MatchResult(score=final, decision=decision, reasons=reasons)

    if final >= th["auto_high"]:
        decision = "auto_high"
    elif final >= th["auto_low"]:
        decision = "auto_low"
    else:
        decision = "rejected"

    return MatchResult(score=final, decision=decision, reasons=reasons)


# -----------------------------------------------------------------------------
#  ISBN 이 양쪽에 다 있을 때 (교보처럼 표지 주소에서 얻어지는 경우)
# -----------------------------------------------------------------------------
def compare_with_isbn(a: Candidate, b: Candidate, cfg: dict) -> MatchResult | None:
    """
    두 책 모두 ISBN13 을 가지고 있으면 그것만으로 확정합니다.
    ISBN 은 책마다 붙는 국제 고유번호라서 이보다 확실한 근거가 없습니다.

    한쪽이라도 ISBN 이 없으면 None 을 돌려줍니다 (→ 일반 점수 비교로 넘어감).
    """
    if not (a.isbn13 and b.isbn13):
        return None
    if a.store_id == b.store_id:
        return _reject("같은 서점 안의 두 상품")

    if a.isbn13 == b.isbn13:
        return MatchResult(
            score=100,
            decision="auto_high",
            reasons={"isbn13": "exact", "score": 100},
        )
    return _reject("ISBN13 이 다름", {"a": a.isbn13, "b": b.isbn13})
