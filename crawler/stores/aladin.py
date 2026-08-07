"""
알라딘 목록 페이지 파서.

※ 목록 페이지만 읽습니다. 도서 상세 페이지에 절대 들어가지 않습니다.
※ 목록에 없는 값(ISBN13 등)은 추정하지 않고 비워 둡니다.
※ 선택자는 config/selectors.yaml 에 있습니다. 여기 코드에는 없습니다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from selectolax.parser import HTMLParser, Node


@dataclass
class BookRow:
    """목록에서 뽑아낸 도서 1권. DB 저장 전 단계."""

    rank: int
    store_book_key: str            # 알라딘 상품번호 (itemid)
    raw_title: str
    raw_author: Optional[str] = None
    raw_publisher: Optional[str] = None
    raw_pub_date: Optional[str] = None    # "2026년 7월" 원본 그대로
    pub_ym: Optional[str] = None          # "2026-07" 로 통일한 값
    sales_point: Optional[int] = None
    cover_url: Optional[str] = None
    series: Optional[str] = None
    isbn13: Optional[str] = None          # 알라딘 목록엔 없음 → 항상 None
    authors: list[tuple[str, str]] = field(default_factory=list)  # [(이름, 역할)]
    events: list[str] = field(default_factory=list)


class ParseError(RuntimeError):
    """구조가 예상과 달라 값을 못 뽑을 때. 조용히 넘어가지 않습니다."""


def _text(node: Optional[Node]) -> Optional[str]:
    if node is None:
        return None
    t = " ".join((node.text() or "").split())
    return t or None


def _first(box: Node, selector: Optional[str]) -> Optional[Node]:
    if not selector:
        return None
    found = box.css(selector)
    return found[0] if found else None


def parse_authors(li_text: str) -> list[tuple[str, str]]:
    """
    "히가시노 게이고 (지은이), 김선영 (옮긴이) | 북다 | 2026년 7월"
      → [("히가시노 게이고", "지은이"), ("김선영", "옮긴이")]

    출판사 이후(첫 번째 | 뒤)는 저자가 아니므로 잘라냅니다.
    """
    head = li_text.split("|", 1)[0]
    pairs: list[tuple[str, str]] = []
    for m in re.finditer(r"([^,(]+?)\s*\(([^)]+)\)", head):
        name = " ".join(m.group(1).split()).strip(" ,")
        role = " ".join(m.group(2).split())
        if name:
            pairs.append((name, role))
    return pairs


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


def parse_sales_point(raw: Optional[str]) -> Optional[int]:
    """' 139,090' → 139090"""
    if not raw:
        return None
    digits = re.sub(r"[^\d]", "", raw)
    return int(digits) if digits else None


def parse_pub_ym(text: str, pattern: str) -> tuple[Optional[str], Optional[str]]:
    """
    "... | 2026년 7월" → ("2026년 7월", "2026-07")
    돌려주는 값: (원본 문자열, 정규화된 YYYY-MM)
    """
    m = re.search(pattern, text)
    if not m:
        return None, None
    year, month = m.group(1), m.group(2)
    return m.group(0).strip(), f"{year}-{int(month):02d}"


def parse_page(
    html: str,
    selectors: dict,
    *,
    role_priority: list[str],
    page: int,
    page_size: int,
) -> list[BookRow]:
    """
    목록 페이지 HTML 한 장에서 도서들을 뽑아냅니다.

    구조가 예상과 다르면 ParseError 를 던집니다.
    빈 목록을 조용히 돌려주는 일은 없습니다. (요구사항 3-3)
    """
    tree = HTMLParser(html)
    boxes = tree.css(selectors["book_box"])

    if not boxes:
        raise ParseError(
            f"도서 칸을 하나도 못 찾았습니다. "
            f"선택자 '{selectors['book_box']}' 가 더 이상 안 맞는 것 같습니다. "
            f"config/selectors.yaml 의 aladin.book_box 를 확인하세요."
        )

    rows: list[BookRow] = []
    key_attr = selectors["store_book_key"].lstrip("@")

    for idx, box in enumerate(boxes):
        # --- 상품번호 (없으면 이 책은 건너뜀. 식별자 없이는 저장 불가) ---
        store_key = (box.attributes.get(key_attr) or "").strip()
        if not store_key:
            continue

        # --- 제목 (필수) ---
        title = _text(_first(box, selectors["title"]))
        if not title:
            raise ParseError(
                f"{idx + 1}번째 도서의 제목을 못 찾았습니다 "
                f"(상품번호 {store_key}). 선택자 '{selectors['title']}' 확인 필요."
            )

        # --- 순위 ---
        rank = (page - 1) * page_size + idx + 1   # 기본값: 목록 순서
        if selectors.get("rank_from_text"):
            m = re.match(r"\s*(\d+)\s*\.", box.text() or "")
            if m:
                rank = int(m.group(1))

        # --- 표지 (알라딘이 1순위 소스) ---
        cover_url = None
        cover_node = _first(box, selectors["cover"])
        if cover_node is not None:
            cover_url = (cover_node.attributes.get("src") or "").strip() or None

        # --- 저자 / 출판사 / 출간월 ---
        authors: list[tuple[str, str]] = []
        raw_author = None
        raw_publisher = None
        raw_pub_date = None
        pub_ym = None

        author_nodes = box.css(selectors["author_links"])
        if author_nodes:
            # 저자 링크가 들어있는 <li> 전체 텍스트를 읽습니다
            li = author_nodes[0].parent
            while li is not None and li.tag != "li":
                li = li.parent
            li_text = _text(li) or ""

            authors = parse_authors(li_text)
            raw_author = pick_representative_author(authors, role_priority)
            if not raw_author:
                raw_author = _text(author_nodes[0])

            raw_pub_date, pub_ym = parse_pub_ym(
                li_text, selectors["pub_date_pattern"]
            )

        pub_node = _first(box, selectors["publisher_link"])
        raw_publisher = _text(pub_node)

        # --- 세일즈포인트 ---
        sales_point = parse_sales_point(_text(_first(box, selectors["sales_point"])))

        # --- 시리즈 / 이벤트 ---
        series = _text(_first(box, selectors.get("series")))
        events = [t for t in (_text(n) for n in box.css(selectors["event"])) if t]

        rows.append(
            BookRow(
                rank=rank,
                store_book_key=store_key,
                raw_title=title,
                raw_author=raw_author,
                raw_publisher=raw_publisher,
                raw_pub_date=raw_pub_date,
                pub_ym=pub_ym,
                sales_point=sales_point,
                cover_url=cover_url,
                series=series,
                isbn13=None,      # 알라딘 목록에는 ISBN13 이 없습니다
                authors=authors,
                events=events,
            )
        )

    # --- 자가 점검: 너무 적게 나오면 이상 신호 ---
    minimum = selectors.get("min_items_per_page", 0)
    if minimum and len(rows) < minimum and len(boxes) >= minimum:
        raise ParseError(
            f"도서 칸은 {len(boxes)}개 찾았는데 실제로 뽑아낸 건 {len(rows)}권뿐입니다. "
            f"구조가 바뀌었을 가능성이 큽니다."
        )

    return rows
