"""
예스24 목록 페이지 파서.

※ 목록 페이지만 읽습니다. 도서 상세 페이지에 절대 들어가지 않습니다.
※ robots.txt 가 /Product/Goods/JsonGoodsList 를 금지하므로
   내부 JSON 요청은 쓰지 않고 정적 HTML 만 파싱합니다. (2026-08-07 확인)
※ 선택자는 config/selectors.yaml 의 yes24 항목에 있습니다.

【알라딘과 다른 점】
저자 표기 방식이 다릅니다.
  알라딘 : "히가시노 게이고 (지은이), 김선영 (옮긴이)"   ← 역할이 괄호 안
  예스24 : "루키우스 안나이우스 세네카 저/하와이 대저택 편역"  ← 역할이 이름 뒤, / 로 구분
그래서 저자 파싱만 서점별로 따로 만듭니다.
"""

from __future__ import annotations

import re

from selectolax.parser import HTMLParser, Node

from .base import (
    BookRow,
    ParseError,
    parse_prices,
    check_yield,
    first,
    parse_number,
    parse_pub_ym,
    pick_representative_author,
    text_of,
    texts_of,
)


def parse_authors(box: Node, selectors: dict) -> list[tuple[str, str]]:
    """
    "루키우스 안나이우스 세네카 저/하와이 대저택 편역"
      → [("루키우스 안나이우스 세네카", "저"), ("하와이 대저택", "편역")]

    저자 이름은 <a> 태그로 감싸여 있고, 역할은 그 뒤의 맨 글자로 나옵니다.
    """
    author_box = first(box, selectors.get("author_box"))
    if author_box is None:
        return []

    full = text_of(author_box) or ""
    names = [t for t in (text_of(a) for a in box.css(selectors["author_links"])) if t]
    if not names:
        return []

    pairs: list[tuple[str, str]] = []
    cursor = 0
    for i, name in enumerate(names):
        pos = full.find(name, cursor)
        if pos < 0:
            pairs.append((name, ""))
            continue
        after = pos + len(name)
        # 다음 저자 이름 직전까지가 이 저자의 역할 표기입니다
        next_pos = len(full)
        if i + 1 < len(names):
            nxt = full.find(names[i + 1], after)
            if nxt >= 0:
                next_pos = nxt
        role = full[after:next_pos]
        role = role.replace("/", " ").replace(",", " ").strip()
        pairs.append((name, role))
        cursor = after

    return pairs


def parse_rank_change(box: Node, selectors: dict) -> tuple[str | None, int | None]:
    """
    예스24가 직접 알려주는 순위 등락을 읽습니다.
      <span class="rank_info rank_up">  → 상승
      <span class="rank_info rank_down">→ 하락
      <span class="rank_info rank_even">→ 변동 없음
      <span class="rank_info rank_new"> → 신규 진입
    """
    node = first(box, selectors.get("rank_info"))
    if node is None:
        return None, None

    cls = (node.attributes.get("class") or "").lower()
    direction = None
    for key in ("rank_up", "rank_down", "rank_even", "rank_new"):
        if key in cls:
            direction = key.replace("rank_", "")
            break

    amount = parse_number(text_of(first(box, selectors.get("rank_change_amount"))))
    return direction, amount


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
            f"예스24: 도서 칸을 하나도 못 찾았습니다. "
            f"선택자 '{selectors['book_box']}' 가 더 이상 안 맞는 것 같습니다. "
            f"config/selectors.yaml 의 yes24.book_box 를 확인하세요."
        )

    rows: list[BookRow] = []
    key_pattern = selectors["store_book_key_pattern"]

    for idx, box in enumerate(boxes):
        # --- 상품번호: 제목 링크 주소에서 숫자만 뽑기 ---
        link = first(box, selectors["store_book_key_from_href"])
        if link is None:
            continue
        href = link.attributes.get("href") or ""
        m = re.search(key_pattern, href)
        if not m:
            continue
        store_key = m.group(1)

        # --- 제목 (필수) ---
        title = text_of(link)
        if not title:
            raise ParseError(
                f"예스24: {idx + 1}번째 도서의 제목을 못 찾았습니다 "
                f"(상품번호 {store_key}). 선택자 '{selectors['title']}' 확인 필요."
            )

        # --- 순위 ---
        rank = (page - 1) * page_size + idx + 1   # 기본값: 목록 순서
        rank_text = text_of(first(box, selectors.get("rank_text")))
        parsed_rank = parse_number(rank_text)
        if parsed_rank:
            rank = parsed_rank

        # --- 표지: 지연 로딩이라 data-original 을 봐야 합니다 ---
        cover_url = None
        cover_node = first(box, selectors["cover"])
        if cover_node is not None:
            attr = selectors.get("cover_attr", "src")
            cover_url = (cover_node.attributes.get(attr) or "").strip() or None

        # --- 정가 / 판매가 (2026-08-11 추가) ---
        #   <em class="yes_b">16,200</em>원  ← 판매가(할인 적용)
        #   <em class="yes_m">18,000</em>원  ← 정가(취소선)
        # ⚠️ 할인이 없으면 취소선 쪽이 아예 없습니다. 그때는 판매가 자리의
        #    값이 곧 정가입니다. 없는 값을 지어내지 않습니다.
        sale_price = parse_number(text_of(first(box, selectors.get("sale_price", ""))))
        list_price = parse_number(text_of(first(box, selectors.get("list_price", ""))))
        if list_price is None:
            list_price, sale_price = sale_price, None

        # --- 저자 ---
        authors = parse_authors(box, selectors)
        raw_author = pick_representative_author(authors, role_priority)

        # --- 출판사 / 출간월 ---
        raw_publisher = text_of(first(box, selectors["publisher_link"]))
        raw_pub_date, pub_ym = parse_pub_ym(
            text_of(first(box, selectors["pub_date"])),
            selectors["pub_date_pattern"],
        )

        # --- 판매지수 ---
        sales_point = parse_number(text_of(first(box, selectors["sales_point"])))

        # --- 해시태그 / 이벤트 ---
        hashtags = [t.lstrip("#") for t in texts_of(box, selectors.get("hashtags"))]
        events = texts_of(box, selectors.get("event"))

        # --- 서점이 알려주는 등락 ---
        change_dir, change_amount = parse_rank_change(box, selectors)

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
                list_price=list_price,
                sale_price=sale_price,
                cover_url=cover_url,
                series=None,
                isbn13=None,      # 예스24 목록에는 ISBN13 이 없습니다
                authors=authors,
                events=events,
                hashtags=hashtags,
                rank_change_dir=change_dir,
                rank_change_amount=change_amount,
            )
        )

    check_yield(rows, boxes, selectors, "예스24")
    return rows
