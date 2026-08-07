"""
교보문고 목록 페이지 파서.

※ 목록 페이지만 읽습니다. 도서 상세 페이지에 절대 들어가지 않습니다.
※ 선택자는 config/selectors.yaml 의 kyobo 항목에 있습니다.

【다른 두 서점과 다른 점 세 가지】

1. 화면 없는 브라우저로 읽습니다.
   교보 HTML 은 빈 껍데기여서 자바스크립트가 실행돼야 도서가 채워집니다.
   (알라딘·예스24 는 그냥 받아오면 됩니다)

2. 저자·출판사·출간일이 한 줄에 붙어 있습니다.
     알라딘 : 각각 다른 태그
     예스24 : 각각 다른 태그
     교보   : "세네카 · 논픽션 · 2026.07.01"  ← 가운뎃점으로 구분
   그래서 나눠 읽는 방법만 서점별로 따로 만듭니다.

3. 표지 주소 안에 ISBN13 이 들어 있습니다. 3사 중 교보만 그렇습니다.
     https://contents.kyobobook.co.kr/sih/fit-in/300x0/pdt/9791199489561.jpg
                                                          └── ISBN13 ──┘
   상세 페이지에 들어가지 않고도 얻을 수 있는 값이라 그대로 씁니다.

【교보에 없는 것】
판매지수·해시태그는 교보가 제공하지 않습니다. 추정하지 않고 비워 둡니다.
"""

from __future__ import annotations

import re

from selectolax.parser import HTMLParser, Node

from .base import (
    BookRow,
    ParseError,
    check_yield,
    first,
    text_of,
    texts_of,
)


def parse_info_line(node: Node | None, selectors: dict) -> tuple[
    str | None, str | None, str | None, str | None
]:
    """
    "세네카 · 논픽션 · 2026.07.01"
      → ("세네카", "논픽션", "2026.07.01", "2026-07")

    돌려주는 값: (저자, 출판사, 원본 출간일, 'YYYY-MM')

    ※ 부분이 모자라면 추정하지 않고 비워 둡니다.
    """
    if node is None:
        return None, None, None, None

    # 출간일은 <span class="date"> 로 따로 표시돼 있어서 그걸 기준점으로 씁니다
    raw_date = text_of(first(node, selectors.get("pub_date_node")))

    sep = selectors.get("info_separator", "·")
    full = text_of(node) or ""
    parts = [p.strip() for p in full.split(sep)]
    parts = [p for p in parts if p]

    # 날짜와 같은 조각은 빼냅니다
    if raw_date:
        parts = [p for p in parts if p != raw_date]

    author = publisher = None
    if len(parts) >= 2:
        # 저자가 여러 명이면 가운뎃점으로 더 나뉠 수 있으므로
        # 마지막 조각을 출판사, 그 앞을 모두 저자로 봅니다
        publisher = parts[-1]
        author = " ".join(parts[:-1])
    elif len(parts) == 1:
        # 하나뿐이면 저자인지 출판사인지 알 수 없습니다. 추정하지 않습니다.
        author = parts[0]

    pub_ym = None
    if raw_date:
        m = re.search(selectors["pub_date_pattern"], raw_date)
        if m:
            pub_ym = f"{m.group(1)}-{int(m.group(2)):02d}"

    return author, publisher, raw_date, pub_ym


def parse_rank(box: Node, selectors: dict) -> int | None:
    """
    순위를 읽습니다.
      1위  : 그림(SVG) 설명에 "교보문고 Best 1"
      2위~ : 작은 칸에 글자로 "2"
    둘 다 못 찾으면 None (호출한 쪽에서 목록 순서로 대신합니다).
    """
    html = box.html or ""

    m = re.search(selectors["rank_badge_pattern"], html)
    if m:
        return int(m.group(1))

    # class 이름에 대괄호가 들어 있어 CSS 선택자로 쓰기 까다로워서
    # 파이썬에서 직접 걸러냅니다.
    marker = selectors["rank_box_class"]
    for div in box.css("div"):
        cls = div.attributes.get("class") or ""
        if marker not in cls:
            continue
        txt = (text_of(div) or "").strip()
        if txt.isdigit():
            return int(txt)
    return None


def parse_cover_and_isbn(box: Node, selectors: dict) -> tuple[str | None, str | None]:
    """
    표지 주소를 찾고, 그 주소에서 ISBN13 을 뽑아냅니다.

    ※ 표지 이미지는 저장하지 않습니다. 주소만 문자열로 보관합니다.
    """
    pattern = selectors["cover_url_pattern"]
    for img in box.css("img"):
        src = (img.attributes.get("src") or "").strip()
        if src and re.search(pattern, src):
            m = re.search(selectors["isbn13_from_cover"], src)
            return src, (m.group(1) if m else None)
    return None, None


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

    # <li> 중에서 상품 링크를 품은 것만 도서 칸입니다
    requires = selectors["book_box_requires"]
    boxes = [
        li for li in tree.css(selectors["book_box"])
        if li.css_first(requires) is not None
    ]

    if not boxes:
        raise ParseError(
            "교보문고: 도서 칸을 하나도 못 찾았습니다. "
            "화면이 다 그려지기 전에 읽었거나, 교보가 화면을 개편했을 수 있습니다. "
            "config/selectors.yaml 의 kyobo.book_box / book_box_requires 를 확인하세요."
        )

    rows: list[BookRow] = []
    key_pattern = selectors["store_book_key_pattern"]

    for idx, box in enumerate(boxes):
        # --- 상품번호 (없으면 식별할 수 없으므로 건너뜀) ---
        link = first(box, selectors["store_book_key_from_href"])
        if link is None:
            continue
        m = re.search(key_pattern, link.attributes.get("href") or "")
        if not m:
            continue
        store_key = m.group(1)

        # --- 제목 (필수) ---
        title = text_of(first(box, selectors["title"]))
        if not title:
            raise ParseError(
                f"교보문고: {idx + 1}번째 도서의 제목을 못 찾았습니다 "
                f"(상품번호 {store_key}). "
                f"선택자 '{selectors['title']}' 확인 필요."
            )

        # --- 순위: 서점이 알려주면 그걸, 없으면 목록 순서 ---
        rank = parse_rank(box, selectors)
        if rank is None:
            rank = (page - 1) * page_size + idx + 1

        # --- 저자 / 출판사 / 출간일 (한 줄에 붙어 있음) ---
        author, publisher, raw_pub_date, pub_ym = parse_info_line(
            first(box, selectors["info_line"]), selectors
        )

        # --- 표지 + ISBN13 ---
        cover_url, isbn13 = parse_cover_and_isbn(box, selectors)

        rows.append(
            BookRow(
                rank=rank,
                store_book_key=store_key,
                raw_title=title,
                raw_author=author,
                raw_publisher=publisher,
                raw_pub_date=raw_pub_date,
                pub_ym=pub_ym,
                sales_point=None,   # 교보는 판매지수를 제공하지 않습니다
                cover_url=cover_url,
                series=None,
                isbn13=isbn13,      # 표지 주소에서 얻음 (상세 페이지 진입 없음)
                authors=[(author, "")] if author else [],
                events=texts_of(box, selectors.get("event")),
                hashtags=[],        # 교보는 해시태그를 제공하지 않습니다
            )
        )

    check_yield(rows, boxes, selectors, "교보문고")
    return rows
