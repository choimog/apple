"""
알라딘 목록 페이지 파서.

※ 목록 페이지만 읽습니다. 도서 상세 페이지에 절대 들어가지 않습니다.
※ 목록에 없는 값(ISBN13 등)은 추정하지 않고 비워 둡니다.
※ 선택자는 config/selectors.yaml 의 aladin 항목에 있습니다.

【예스24와 다른 점】
저자 표기 방식이 다릅니다.
  알라딘 : "히가시노 게이고 (지은이), 김선영 (옮긴이)"   ← 역할이 괄호 안
  예스24 : "루키우스 안나이우스 세네카 저/하와이 대저택 편역"  ← 역할이 이름 뒤
그래서 저자 파싱만 서점별로 따로 만듭니다.
"""

from __future__ import annotations

import re

from selectolax.parser import HTMLParser

from .base import (
    BookRow,
    ParseError,
    diagnose_empty,
    box_text,
    parse_prices,
    check_yield,
    first,
    parse_number,
    parse_pub_ym,
    pick_representative_author,
    text_of,
    texts_of,
)


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


def parse_page(
    html: str,
    selectors: dict,
    *,
    role_priority: list[str],
    page: int,
    page_size: int,
) -> list[BookRow]:
    """목록 페이지 HTML 한 장에서 도서들을 뽑아냅니다."""
    tree = HTMLParser(html)
    boxes = tree.css(selectors["book_box"])

    if not boxes:
        raise ParseError(
            diagnose_empty(html, "알라딘", selectors["book_box"])
        )

    rows: list[BookRow] = []
    key_attr = selectors["store_book_key"].lstrip("@")

    for idx, box in enumerate(boxes):
        # --- 상품번호 (없으면 식별할 수 없으므로 건너뜀) ---
        store_key = (box.attributes.get(key_attr) or "").strip()
        if not store_key:
            continue

        # --- 제목 (필수) ---
        title = text_of(first(box, selectors["title"]))
        if not title:
            raise ParseError(
                f"알라딘: {idx + 1}번째 도서의 제목을 못 찾았습니다 "
                f"(상품번호 {store_key}). 선택자 '{selectors['title']}' 확인 필요."
            )

        # --- 순위: 도서 칸 맨 앞의 "2." 형태 숫자 ---
        rank = (page - 1) * page_size + idx + 1   # 기본값: 목록 순서
        if selectors.get("rank_from_text"):
            m = re.match(r"\s*(\d+)\s*\.", box.text() or "")
            if m:
                rank = int(m.group(1))

        # --- 표지 (알라딘이 1순위 소스. cover200 = 작은 썸네일) ---
        cover_url = None
        cover_node = first(box, selectors["cover"])
        if cover_node is not None:
            cover_url = (cover_node.attributes.get("src") or "").strip() or None

        # --- 정가 / 판매가 (2026-08-11 추가) ---
        list_price, sale_price = parse_prices(box_text(box))

        # --- 저자 / 출간월 (같은 <li> 안에 함께 들어 있음) ---
        authors: list[tuple[str, str]] = []
        raw_author = None
        raw_pub_date = None
        pub_ym = None

        author_nodes = box.css(selectors["author_links"])
        if author_nodes:
            li = author_nodes[0].parent
            while li is not None and li.tag != "li":
                li = li.parent
            li_text = text_of(li) or ""

            authors = parse_authors(li_text)
            raw_author = pick_representative_author(authors, role_priority)
            if not raw_author:
                raw_author = text_of(author_nodes[0])

            raw_pub_date, pub_ym = parse_pub_ym(
                li_text, selectors["pub_date_pattern"]
            )

        raw_publisher = text_of(first(box, selectors["publisher_link"]))
        sales_point = parse_number(text_of(first(box, selectors["sales_point"])))
        series = text_of(first(box, selectors.get("series")))
        events = texts_of(box, selectors.get("event"))

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
                # 정가·판매가 — "22,000원 → 19,800원 (10%할인)"
                # 클래스가 없는 span 이라 칸 전체 글자에서 읽습니다.
                list_price=list_price,
                sale_price=sale_price,
                cover_url=cover_url,
                series=series,
                isbn13=None,      # 알라딘 목록에는 ISBN13 이 없습니다
                authors=authors,
                events=events,
                hashtags=[],      # 알라딘은 해시태그를 제공하지 않습니다
            )
        )

    check_yield(rows, boxes, selectors, "알라딘")
    return rows
