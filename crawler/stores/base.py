"""
서점 파서들이 공통으로 쓰는 것들.

서점마다 화면 구조는 다르지만, 뽑아내는 결과물의 형태는 같아야 합니다.
그래야 저장·매칭 코드를 서점마다 따로 만들지 않아도 됩니다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from selectolax.parser import Node


@dataclass
class BookRow:
    """목록에서 뽑아낸 도서 1권. 어느 서점이든 이 형태로 통일됩니다."""

    rank: int
    store_book_key: str                    # 서점 내부 상품번호
    raw_title: str
    raw_author: Optional[str] = None       # 대표 저자 (역할 우선순위로 선택)
    raw_publisher: Optional[str] = None
    raw_pub_date: Optional[str] = None     # 서점이 보여준 원본 문자열
    pub_ym: Optional[str] = None           # 'YYYY-MM' 로 통일한 값
    sales_point: Optional[int] = None      # 판매지수/세일즈포인트. 교보는 항상 None
    # 【2026-08-11 대표님 지적】 "왜 우리 지금까지 정가를 고려하지 않았지?"
    #  목록 페이지에 정가와 판매가가 둘 다 나와 있는데 안 걷고 있었습니다.
    #  정가는 도서정가제상 출판사가 정한 값이라 **3사가 같아야 정상**입니다.
    #  판형·개정판이 다르면 정가가 다르므로, 갈라내는 근거로도 씁니다.
    list_price: Optional[int] = None       # 정가 (원)
    sale_price: Optional[int] = None       # 실제 판매가 (할인 적용)
    cover_url: Optional[str] = None
    series: Optional[str] = None
    isbn13: Optional[str] = None           # 3사 모두 목록에 없음 → 항상 None
    authors: list[tuple[str, str]] = field(default_factory=list)  # [(이름, 역할)]
    events: list[str] = field(default_factory=list)
    hashtags: list[str] = field(default_factory=list)
    # 서점이 알려주는 등락 (예스24만 제공). 우리 계산값과 교차 검증용.
    rank_change_dir: Optional[str] = None   # 'up' | 'down' | 'even' | 'new'
    rank_change_amount: Optional[int] = None


# 가격 표기 예시
#   알라딘 : "22,000원 → 19,800원 (10%할인)"   ← 앞이 정가, 뒤가 판매가
#   예스24 : "16,200원  18,000원"              ← 앞이 판매가, 뒤가(취소선) 정가
#   할인이 없으면 하나만 나옵니다.
_PRICE = re.compile(r"([0-9][0-9,]{2,})\s*원")

# -----------------------------------------------------------------------------
#  🚨 값이 아닌 숫자를 걸러내는 말들 (2026-08-12 대표님이 원인을 찾아 주심)
# -----------------------------------------------------------------------------
#  "문학동네의 긴긴밤이란 책이 예스랑 교보에는 12,500원인데 알라딘엔
#   15,000원으로 등록되어있어. 실제로 가보니 12,500원인데"
#
#  대표님이 알라딘 화면에서 원인을 찾아 주셨습니다. 이벤트 도서에는
#  칸마다 이런 문구가 붙어 있습니다.
#
#      캐리어·백 리플렉터 택 세트 (대상도서 15,000원 이상)
#      8월 특별 선물 … (이벤트 도서 포함 국내서·외서 5만원 이상)
#
#  알라딘·교보는 정가 전용 이름표가 없어 **칸 글자를 통째로 훑습니다.**
#  그래서 이 15,000 이 숫자 목록에 섞여 들어가고, 큰 값이 정가가 되는
#  규칙 때문에 12,500원짜리 책이 15,000원으로 저장됐습니다.
#
#  이건 『긴긴밤』 한 권의 문제가 아닙니다. **이벤트 도서이면서 정가가
#  15,000원보다 싼 책 전부**가 같은 값으로 잘못 저장됩니다. 게다가 정가가
#  다르면 다른 책으로 갈라내므로 **알라딘만 안 묶이는 책**도 생깁니다.
#
#  【어떻게 거르나요】
#  숫자 뒤에 '이상·이하·이내·부터·미만' 이 붙으면 그건 **조건**이지 값이
#  아닙니다. 앞쪽에 '적립·쿠폰·마일리지·사은품·배송·이벤트' 같은 말이
#  있어도 값이 아닙니다.
#
#  ⚠️ 여기 없는 새로운 문구가 나오면 또 틀립니다. 그래서 이 목록에
#     기대지 말고, 서점이 정가 이름표를 주면 그것을 먼저 쓰도록
#     되어 있습니다(예스24가 그렇습니다).
# -----------------------------------------------------------------------------
# 숫자 **뒤**에 붙으면 조건입니다 — "15,000원 이상"
_COND_AFTER = re.compile(r"^\s*(원)?\s*(이상|이하|이내|미만|부터|초과)")
# 숫자 **앞**에 있으면 값이 아닙니다 — "적립 1,000원"
_PROMO_WORDS = (
    "적립", "쿠폰", "마일리지", "포인트", "사은품", "증정", "배송",
    "이벤트", "혜택", "캐시", "할인권", "상품권",
)

# 책 한 권의 정가로 있을 수 없는 값. 이보다 크면 읽기가 틀린 것입니다.
# (전집·세트도 200만 원을 넘는 일은 거의 없습니다. 넘으면 버립니다 —
#  틀린 값을 저장하는 것보다 빈 값이 낫습니다)
PRICE_MAX = 2_000_000


def box_text(node) -> str:
    """
    칸 안의 글자를 꺼냅니다. **태그 사이에 공백을 넣습니다.**

    【왜 이게 중요한가요? — 2026-08-11, 실제로 사고가 났습니다】
    교보 정가를 대조해 보니 이런 값이 저장돼 있었습니다.

        교보문고: 2,918,000원  SQL 자격검정 실전문제
        알라딘  :    18,000원  SQL 자격검정 실전문제

        교보문고: 1,332,000원  스타팅 스트렝스
        알라딘  :    32,000원  스타팅 스트렝스

    자세히 보면 **앞의 두 자리 + 진짜 가격** 입니다.
        29 + 18,000  → 2918000
        13 + 32,000  → 1332000

    태그가 붙어 있으면 글자가 그대로 이어붙기 때문입니다.

        <span>29</span><span>18,000</span>원  →  "2918,000원"

    할인율 '29' 와 가격 '18,000' 사이에 아무것도 없어서 한 덩어리가
    됐습니다. 그러면 매칭이 '정가가 다르니 다른 책' 이라며 **멀쩡한
    짝을 갈라냅니다.** 화면에는 아무 표시도 안 납니다.

    공백을 넣으면 "29 18,000 원" 이 되어 제대로 18,000 을 읽습니다.
    """
    if node is None:
        return ""
    try:
        return node.text(separator=" ")
    except TypeError:      # 아주 옛 버전 대비
        return node.text()


def parse_prices(text: str | None, list_first: bool = True) -> tuple[
    Optional[int], Optional[int]
]:
    """
    글자에서 정가와 판매가를 뽑습니다. 돌려주는 값: (정가, 판매가)

    【왜 정가가 중요한가요? — 2026-08-11 대표님 지적】
    도서정가제상 정가는 출판사가 정한 하나의 값이라 **3사가 같아야
    정상**입니다. 판형·개정판이 다르면 정가가 다르므로, 다른 책을
    갈라내는 근거로도 씁니다.

    ⚠️ 값이 하나뿐이면 **정가로만** 봅니다. 판매가를 지어내지 않습니다.
       (할인 중이 아닌 책은 정가 = 판매가지만, 그건 우리가 정할 일이
        아니라 서점이 보여준 대로 두는 것이 맞습니다)

    ⚠️ 말도 안 되는 값은 **버립니다**(PRICE_MAX). 태그가 이어붙어
       할인율과 가격이 한 덩어리가 되는 사고가 실제로 있었습니다.
       공백을 넣는 것으로 원인을 고쳤지만, 다른 서점에서 같은 일이
       또 생겨도 틀린 값이 저장되지는 않게 막아 둡니다.
    """
    if not text:
        return None, None

    nums: list[int] = []
    for m in _PRICE.finditer(text):
        # 🚨 숫자 뒤가 '이상/이하…' 면 값이 아니라 **조건**입니다.
        #    (대상도서 15,000원 이상) 같은 이벤트 문구를 거릅니다.
        if _COND_AFTER.match(text[m.end():m.end() + 12]):
            continue
        # 🚨 숫자 앞에 '적립·쿠폰·배송…' 이 있으면 값이 아닙니다.
        before = text[max(0, m.start() - 14):m.start()]
        if any(w in before for w in _PROMO_WORDS):
            continue
        nums.append(int(m.group(1).replace(",", "")))

    # 마일리지·적립금 같은 작은 값, 그리고 있을 수 없이 큰 값은 뺍니다.
    nums = [n for n in nums if 1000 <= n <= PRICE_MAX]
    if not nums:
        return None, None
    if len(nums) == 1:
        return nums[0], None
    a, b = nums[0], nums[1]
    lo, hi = (b, a) if a > b else (a, b)
    # 정가가 판매가보다 쌀 수는 없습니다. 큰 쪽이 정가입니다.
    return (hi, lo) if list_first or True else (hi, lo)


def price_text(node, drop: list[str] | None = None) -> str:
    """
    가격을 찾을 글자. **이벤트 문구 같은 덩어리를 먼저 빼고** 돌려줍니다.

    【왜 필요한가요? — 2026-08-12】
    알라딘 이벤트 도서에는 칸마다 이런 문구가 붙습니다.

        캐리어·백 리플렉터 택 세트 (대상도서 15,000원 이상)

    parse_prices 가 '이상' 을 보고 거르기는 하지만, 그건 **말 목록에
    기대는 방법**이라 새로운 문구가 나오면 또 뚫립니다.
    그래서 서점이 이벤트 문구에 이름표를 달아 준 경우에는 **그 덩어리를
    통째로 먼저 빼** 둡니다. 두 겹으로 막는 것입니다.

    ⚠️ 화면을 고치지 않습니다(지우지 않습니다). 읽을 글자만 따로 만듭니다.
       다른 값(이벤트 문구 자체)을 읽는 코드가 그대로 돌아야 하니까요.
    """
    text = box_text(node)
    for sel in drop or []:
        if not sel:
            continue
        for bad in node.css(sel):
            piece = " ".join((box_text(bad) or "").split())
            if len(piece) >= 3:
                text = text.replace(piece, " ")
    return text


class ParseError(RuntimeError):
    """구조가 예상과 달라 값을 못 뽑을 때. 조용히 넘어가지 않습니다."""


def text_of(node: Optional[Node]) -> Optional[str]:
    """태그 안의 글자를 꺼내고 공백을 정리합니다."""
    if node is None:
        return None
    t = " ".join((node.text() or "").split())
    return t or None


def first(box: Node, selector: Optional[str]) -> Optional[Node]:
    """선택자에 맞는 첫 번째 태그를 찾습니다. 없으면 None."""
    if not selector:
        return None
    found = box.css(selector)
    return found[0] if found else None


def texts_of(box: Node, selector: Optional[str]) -> list[str]:
    """선택자에 맞는 모든 태그의 글자를 모읍니다."""
    if not selector:
        return []
    return [t for t in (text_of(n) for n in box.css(selector)) if t]


def parse_number(raw: Optional[str]) -> Optional[int]:
    """' 판매지수 302,604 ' → 302604"""
    if not raw:
        return None
    digits = re.sub(r"[^\d]", "", raw)
    return int(digits) if digits else None


def parse_pub_ym(text: Optional[str], pattern: str) -> tuple[Optional[str], Optional[str]]:
    """
    "2026년 07월" → ("2026년 07월", "2026-07")
    돌려주는 값: (원본 문자열, 정규화된 YYYY-MM)
    """
    if not text:
        return None, None
    m = re.search(pattern, text)
    if not m:
        return None, None
    year, month = m.group(1), m.group(2)
    return m.group(0).strip(), f"{year}-{int(month):02d}"


def pick_representative_author(
    authors: list[tuple[str, str]], role_priority: list[str]
) -> Optional[str]:
    """
    대표 저자를 역할 우선순위로 고릅니다. (사용자 확정: Q4-4 '우선순위로')
    우선순위 목록에 없는 역할은 맨 뒤로 밀립니다.
    """
    if not authors:
        return None

    def score(item: tuple[str, str]) -> int:
        _, role = item
        for i, key in enumerate(role_priority):
            if key in role:
                return i
        return len(role_priority) + 1

    return min(authors, key=score)[0]


# 서점이 막았을 때 흔히 나오는 말들
_BLOCK_WORDS = (
    "비정상적인 접근", "자동입력", "보안문자", "캡차", "captcha",
    "접근이 차단", "일시적으로 접속", "잠시 후 다시", "robot",
    "Access Denied", "Too Many Requests", "서비스 점검", "점검 중",
)


def diagnose_empty(html: str, store_name: str, selector: str) -> str:
    """
    도서 칸을 하나도 못 찾았을 때, **왜 그런지 갈라서** 말해 줍니다.

    【왜 필요한가요? — 2026-08-11 대표님 신고】
    예스24 10개 분야에서 이런 오류가 났습니다.

        선택자 'div.itemUnit' 가 더 이상 안 맞는 것 같습니다.
        config/selectors.yaml 의 yes24.book_box 를 확인하세요.

    그런데 같은 날 아침 정기 수집은 멀쩡했고, 28개 분야 중 10개만,
    그것도 **연속된 두 덩어리**로 실패했습니다. 화면이 개편됐다면
    28개가 전부 실패해야 합니다.

    즉 **화면 개편이 아니라 일시적으로 막힌 것**인데, 오류 문구는
    "선택자를 확인하세요" 라고 엉뚱한 곳을 가리켰습니다.
    그 말을 믿고 멀쩡한 설정을 고치면 진짜 망가집니다.

    이제 세 가지를 갈라서 말합니다.
      · 막힌 것 같다      → 잠시 뒤 다시 (설정 건드리지 마세요)
      · 페이지가 너무 짧다 → 빈 응답. 역시 다시
      · 진짜 구조가 바뀜   → 설정 확인
    """
    body = html or ""
    head = body[:4000]

    for w in _BLOCK_WORDS:
        if w.lower() in body.lower():
            return (
                f"{store_name}: 서점이 **일시적으로 막은 것 같습니다** "
                f"(페이지에 '{w}' 라는 말이 있습니다).\n"
                f"   설정은 건드리지 마세요. 잠시 뒤 다시 수집하면 됩니다.\n"
                f"   같은 날 여러 번 수집하면 이런 일이 생길 수 있습니다."
            )

    if len(body) < 3000:
        return (
            f"{store_name}: 받은 페이지가 너무 짧습니다({len(body):,}자). "
            f"내용이 안 온 것으로 보입니다.\n"
            f"   설정 문제가 아닐 가능성이 큽니다. 잠시 뒤 다시 해 보세요."
        )

    return (
        f"{store_name}: 도서 칸을 하나도 못 찾았습니다. "
        f"선택자 '{selector}' 가 더 이상 안 맞는 것 같습니다.\n"
        f"   페이지는 정상 크기({len(body):,}자)이고 막힌 흔적도 없습니다.\n"
        f"   ⚠️ 다른 분야도 함께 실패했는지 보세요. **전부** 실패했으면\n"
        f"      화면 개편입니다 → config/selectors.yaml 확인.\n"
        f"      **일부만** 실패했으면 일시적인 문제일 가능성이 큽니다.\n"
        f"   페이지 앞부분: {head[:200]!r}"
    )


def check_yield(rows: list, boxes: list, selectors: dict, store_name: str) -> None:
    """
    자가 점검: 도서 칸은 찾았는데 실제로 뽑아낸 게 너무 적으면
    구조가 바뀐 것으로 보고 명시적으로 실패시킵니다. (요구사항 3-3)
    """
    minimum = selectors.get("min_items_per_page", 0)
    if minimum and len(rows) < minimum and len(boxes) >= minimum:
        raise ParseError(
            f"{store_name}: 도서 칸은 {len(boxes)}개 찾았는데 실제로 뽑아낸 건 "
            f"{len(rows)}권뿐입니다. 구조가 바뀌었을 가능성이 큽니다. "
            f"config/selectors.yaml 확인 필요."
        )
