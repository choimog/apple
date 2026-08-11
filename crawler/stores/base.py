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
    """
    if not text:
        return None, None
    nums = [int(m.group(1).replace(",", "")) for m in _PRICE.finditer(text)]
    # 마일리지·적립금 같은 작은 값이 섞일 수 있습니다. 너무 작은 값은 뺍니다.
    nums = [n for n in nums if n >= 1000]
    if not nums:
        return None, None
    if len(nums) == 1:
        return nums[0], None
    a, b = nums[0], nums[1]
    lo, hi = (b, a) if a > b else (a, b)
    # 정가가 판매가보다 쌀 수는 없습니다. 큰 쪽이 정가입니다.
    return (hi, lo) if list_first or True else (hi, lo)


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
