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

from dataclasses import dataclass, field
from difflib import SequenceMatcher


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
    # -------------------------------------------------------------------------
    same_price = None                    # None = 한쪽이라도 모름
    if a.list_price and b.list_price:
        same_price = a.list_price == b.list_price
        if not same_price and th.get("price_hard", True):
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
        and a.norm_publisher == b.norm_publisher
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
        pub_sim = similarity(a.norm_publisher, b.norm_publisher)
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
    ym_gap = _months_apart(a.pub_ym, b.pub_ym)
    if ym_gap is not None and th.get("pub_ym_hard", True):
        allow = p.get("pub_ym_near_months", 1)
        if ym_gap > allow:
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
        if a.norm_author == b.norm_author:
            score += w["author"]
            reasons["author"] = "exact"
        else:
            sim = similarity(a.norm_author, b.norm_author)
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
        if a.norm_publisher == b.norm_publisher:
            score += w["publisher"]
            reasons["publisher"] = "exact"
        else:
            sim = similarity(a.norm_publisher, b.norm_publisher)
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
