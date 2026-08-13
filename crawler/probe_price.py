"""
=============================================================================
 정가 탐침 — 목록 한 칸 안의 '숫자'를 전부 꺼내 봅니다
=============================================================================

 【왜 만들었나요? — 2026-08-12 대표님 신고】

   "문학동네의 긴긴밤이란 책이 예스랑 교보에는 12,500원으로 등록되어
    있고 알라딘엔 15,000원으로 등록되어 있어.
    실제로 가보니 알라딘에도 12,500원인데
    왜 저 책만 가격이 저렇게 수집되었는지도 의문이지만"

 【의심하는 것】
 예스24는 정가 전용 이름표(em.yes_m)가 있어서 그것만 콕 집어 읽습니다.
 그런데 **교보와 알라딘은 이름표가 없어서 도서 칸 글자를 통째로 훑어
 숫자를 모으고, 그중 큰 값을 정가로 봅니다.**

 그래서 칸 안에 정가보다 큰 숫자가 하나라도 있으면 그게 정가가 됩니다.
 예를 들어 배송 안내('15,000원 이상 무료배송') 같은 문구가 칸 안에
 들어 있으면, 정가가 12,500원인 책은 15,000원으로 저장됩니다.

 ⚠️ 이건 아직 **짐작**입니다. 짐작으로 고치면 다른 것이 깨집니다.
    그래서 실제 화면을 받아 **숫자마다 앞뒤 글자를 같이** 보여 줍니다.
    무엇이 무엇인지 눈으로 확인한 다음에 고칩니다.

 【규칙은 그대로 지킵니다】
   · 매일 이미 받고 있는 **그 목록 페이지**를 딱 한 장 더 받습니다
   · robots.txt 를 먼저 확인하고, 금지면 그 서점은 건너뜁니다
   · 상세 페이지에 들어가지 않습니다
   · 표지 이미지를 저장하지 않습니다
   · 서점 공식 API 를 쓰지 않습니다
   · 데이터베이스에 아무것도 저장하지 않습니다. 보기만 합니다

 실행: GitHub → Actions → [정가 탐침]
=============================================================================
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

from selectolax.parser import HTMLParser  # noqa: E402

from common import config as cfg  # noqa: E402
from common.http import PoliteClient  # noqa: E402
from common.robots import parse as parse_robots  # noqa: E402
from stores.base import PRICE_MAX, box_text, parse_prices  # noqa: E402

BOOKS = 5           # 서점마다 몇 칸을 뜯어볼지
_NUM = re.compile(r"[\d,]{3,}")


def origin_of(url: str) -> str:
    p = urlsplit(url)
    return f"{p.scheme}://{p.netloc}"


def numbers_with_context(text: str, width: int = 22) -> list[tuple[str, str]]:
    """숫자마다 (값, 앞뒤 글자) 를 돌려줍니다. 무엇을 읽었는지 보이게."""
    out = []
    for m in _NUM.finditer(text):
        raw = m.group(0)
        if raw.strip(",").isdigit() is False:
            continue
        s = max(0, m.start() - width)
        e = min(len(text), m.end() + width)
        around = " ".join(text[s:e].split())
        out.append((raw, around))
    return out


def probe_store(store: dict, defaults: dict) -> None:
    name = store.get("name") or store.get("code")
    sel = cfg.load("selectors.yaml").get(store.get("code") or "", {}) or {}
    cats = store.get("categories") or []
    if not cats:
        print(f"\n■ {name}: 분야 설정이 없어 건너뜁니다.")
        return

    url = str(cats[0].get("url", "")).replace("{page}", "1")
    ua = defaults.get("user_agent", "bestseller-tracker")
    origin = origin_of(url)

    print("\n" + "=" * 70)
    print(f"■ {name}")
    print(f"   {url}")
    has_selector = bool(sel.get("list_price"))
    print(f"   정가 전용 이름표: "
          + (f"있음 ({sel.get('list_price')})" if has_selector
             else "🚨 없음 → 칸 글자를 통째로 훑습니다"))

    # ---- robots.txt 를 먼저 ----
    try:
        with PoliteClient(user_agent=ua, delay_min=1.0, delay_max=1.5) as c:
            r = c.get(f"{origin}/robots.txt", allow_status=(403, 404),
                      check_block_markers=False, min_body_len=1)
        if r.status_code == 200:
            allowed, why = parse_robots(r.text).is_allowed(url, ua)
            if not allowed:
                print(f"   🚫 robots.txt 가 막고 있습니다 — {why}")
                print("      건너뜁니다. 임의로 우회하지 않습니다.")
                return
            print(f"   ✅ robots.txt 확인: {why}")
        else:
            print(f"   ✅ robots.txt 없음(HTTP {r.status_code}) → 제한 없음")
    except Exception as exc:  # noqa: BLE001
        print(f"   ⚠️ robots.txt 확인 실패({exc}) → 안전하게 건너뜁니다.")
        return

    # ---- 목록 한 장 ----
    try:
        with PoliteClient(
            user_agent=ua,
            delay_min=defaults.get("delay_min_sec", 1.0),
            delay_max=defaults.get("delay_max_sec", 2.0),
            timeout=defaults.get("timeout_sec", 20),
            referer=origin,
        ) as c:
            html = c.get(url).text
    except Exception as exc:  # noqa: BLE001
        print(f"   ⚠️ 목록을 받지 못했습니다: {exc}")
        return

    boxes = HTMLParser(html).css(sel.get("book_box") or "")
    if not boxes:
        print(f"   ⚠️ 도서 칸을 못 찾았습니다 (book_box={sel.get('book_box')})")
        return
    print(f"   도서 칸 {len(boxes)}개 — 앞 {BOOKS}개를 뜯어봅니다\n")

    for i, box in enumerate(boxes[:BOOKS], 1):
        title = ""
        t = box.css(sel.get("title") or "")
        if t:
            title = " ".join((t[0].text() or "").split())[:40]
        text = box_text(box)
        got_list, got_sale = parse_prices(text)

        print(f"   [{i}] {title}")
        print(f"       지금 뽑는 값 → 정가 {got_list!r} · 판매가 {got_sale!r}")
        nums = numbers_with_context(text)
        kept = [n for n, _ in nums
                if n.replace(",", "").isdigit()
                and 1000 <= int(n.replace(",", "")) <= PRICE_MAX]
        print(f"       칸 안의 숫자 {len(nums)}개 (그중 값으로 쓰일 수 있는 것 {len(kept)}개)")
        for raw, around in nums[:10]:
            n = raw.replace(",", "")
            mark = "  " if not n.isdigit() else (
                "✅" if 1000 <= int(n) <= PRICE_MAX else "  ")
            print(f"         {mark} {raw:>12}   …{around}…")
        if len(nums) > 10:
            print(f"         … 외 {len(nums) - 10}개")
        print()


def main() -> int:
    print("=" * 70)
    print("  정가 탐침 — 칸 안의 숫자를 전부 꺼내 봅니다")
    print("  (아무것도 저장하지 않습니다. 목록 한 장씩만 받습니다)")
    print("=" * 70)

    src = cfg.load("sources.yaml")
    defaults = src.get("defaults", {})
    for key in ("kyobo_online", "yes24", "aladin"):
        store = src.get(key)
        if store:
            probe_store(store, defaults)

    print("\n" + "=" * 70)
    print("  이 결과를 저에게 그대로 보내 주세요.")
    print("  '지금 뽑는 값' 이 실제 정가와 다른 칸이 있으면, 그 칸의 숫자")
    print("  목록에서 어떤 것이 잘못 뽑혔는지 바로 보입니다.")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
