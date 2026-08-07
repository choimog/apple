"""
=============================================================================
 서점 구조 탐침 — 크롤러를 만들기 전에 실제 HTML 구조를 확인합니다
=============================================================================

 알라딘 때와 같은 방식입니다. 추측으로 선택자를 쓰지 않기 위해,
 도서 한 칸의 실제 HTML 을 그대로 출력해서 보고 작성합니다.

 실행: Actions → [서점 구조 탐침] → Run workflow → store 선택
 ※ 서점당 목록 페이지 1건만 요청합니다. 상세 페이지 진입 없음.
=============================================================================
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import traceback
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common.http import PoliteClient  # noqa: E402

USER_AGENT = "BestsellerTracker/1.0 (+https://github.com/choimog/apple)"

TARGETS = {
    "yes24": {
        "name": "예스24",
        "origin": "https://www.yes24.com",
        "url": ("https://www.yes24.com/product/category/bestseller"
                "?categoryNumber=001&pageNumber=1&pageSize=24"),
        # 정찰에서 pageSize 와 정확히 일치하는 개수로 나온 후보
        "candidates": [".itemUnit", "#yesBestList > li", ".item_info", ".item_img"],
    },
    "kyobo": {
        "name": "교보문고",
        "origin": "https://store.kyobobook.co.kr",
        "url": "https://store.kyobobook.co.kr/bestseller/online/weekly/domestic?page=1",
        # 교보는 Tailwind 라 class 이름이 길어서 후보를 넓게 잡습니다
        "candidates": [
            "li", "tr",
            "div.flex.items-center.justify-center.gap-9",
            "[class*='prod']", "[class*='book']", "[data-kbbfn]",
        ],
    },
}


def sep(title: str) -> None:
    print("\n" + "=" * 70)
    print(f"  {title}")
    print("=" * 70)


def clean(html: str) -> str:
    html = re.sub(r"<script[\s\S]*?</script>", "", html, flags=re.I)
    html = re.sub(r"<style[\s\S]*?</style>", "", html, flags=re.I)
    html = re.sub(r"<!--[\s\S]*?-->", "", html)
    html = re.sub(r"\s+", " ", html)
    return re.sub(r">\s*<", ">\n<", html).strip()


def probe(store_key: str) -> None:
    from selectolax.parser import HTMLParser

    t = TARGETS[store_key]
    sep(f"{t['name']} 구조 탐침")
    print(f"URL: {t['url']}\n")

    with PoliteClient(user_agent=USER_AGENT, delay_min=1.5, delay_max=2.5,
                      referer=t["origin"]) as client:
        resp = client.get(t["url"])

    html = resp.text
    print(f"✅ HTTP {resp.status_code}, 본문 {len(html):,}자")
    tree = HTMLParser(html)

    # --- 1. 도서 칸 후보별 개수 ---
    sep("도서 칸 후보 개수")
    print("(페이지당 권수와 같은 숫자가 나오는 게 정답입니다)")
    for sel in t["candidates"]:
        try:
            print(f"  {sel:<48} → {len(tree.css(sel))}개")
        except Exception as exc:  # noqa: BLE001
            print(f"  {sel:<48} → 선택자 오류: {exc}")

    # --- 2. 자주 나오는 class 이름 (컨테이너 찾기용) ---
    sep("자주 반복되는 class 이름 상위 25개")
    classes = re.findall(r'class="([^"]{2,80})"', html)
    for c, n in Counter(x.strip() for x in classes).most_common(25):
        print(f"  {n:>4}회  {c}")

    # --- 3. 상품 링크에서 상품번호 패턴 찾기 ---
    sep("상품 링크 패턴 (서점 내부 상품번호 확인용)")
    hrefs = re.findall(r'href="([^"]*(?:product|goods|detail)[^"]*)"', html, re.I)
    for h in list(dict.fromkeys(hrefs))[:8]:
        print(f"  {h[:130]}")

    # --- 4. 이미지(표지) 주소 패턴 ---
    sep("이미지 주소 패턴 (표지 후보)")
    imgs = re.findall(r'(?:src|data-original|data-src|data-lazy)="(https?://[^"]+)"', html)
    seen = []
    for u in imgs:
        low = u.lower()
        if any(b in low for b in ("logo", "banner", "icon", "sprite", "blank", "gnb")):
            continue
        if u not in seen:
            seen.append(u)
        if len(seen) >= 6:
            break
    for u in seen:
        print(f"  {u[:130]}")

    # --- 5. 가장 유력한 컨테이너의 첫 항목 HTML 덤프 ---
    best_sel, best_nodes = None, []
    for sel in t["candidates"]:
        try:
            nodes = tree.css(sel)
        except Exception:  # noqa: BLE001
            continue
        # 20~120개 사이면 도서 목록일 가능성이 큼
        if 15 <= len(nodes) <= 130 and len(nodes) > len(best_nodes):
            best_sel, best_nodes = sel, nodes

    if not best_nodes:
        sep("⚠️ 유력한 도서 칸 후보를 못 찾았습니다")
        print("위 class 목록을 보고 후보를 다시 정해야 합니다.")
        return

    sep(f"유력 컨테이너: {best_sel} ({len(best_nodes)}개) — 첫 항목 HTML")
    dumped = clean(best_nodes[0].html or "")
    print(dumped[:5500])
    if len(dumped) > 5500:
        print(f"\n... (총 {len(dumped)}자, 이하 생략)")

    sep("첫 항목 — 링크")
    for a in best_nodes[0].css("a")[:14]:
        href = (a.attributes.get("href") or "").strip()
        txt = " ".join((a.text() or "").split())[:45]
        if href:
            print(f"  {href[:110]}")
            if txt:
                print(f"      텍스트: {txt}")

    sep("첫 항목 — 이미지")
    for img in best_nodes[0].css("img")[:6]:
        for k, v in img.attributes.items():
            if v and ("src" in k or "lazy" in k or "original" in k):
                print(f"  {k} = {v[:120]}")

    sep("첫 항목 — 순수 텍스트")
    print(" ".join((best_nodes[0].text() or "").split())[:1000])

    sep("첫 항목 — 필드 흔적")
    raw = best_nodes[0].html or ""
    for label, pat in [
        ("판매지수", r"판매지수[^0-9]{0,60}?([\d,]+)"),
        ("ISBN13", r"\b(97[89]\d{10})\b"),
        ("출간일", r"(\d{4}\s*[년.\-/]\s*\d{1,2}\s*[월.\-/]?(?:\s*\d{1,2}\s*일?)?)"),
        ("상품번호", r"(?:goods|product|detail)[/=]?(\d{6,})"),
        ("순위", r'rank[^>]*>\s*(\d+)'),
    ]:
        m = re.search(pat, raw, re.I)
        print(f"  {label:<10} {'→ ' + m.group(1) if m else '(못 찾음)'}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--store", default=os.environ.get("PROBE_STORE", "yes24"))
    args = ap.parse_args()

    stores = [s.strip() for s in args.store.split(",") if s.strip() in TARGETS]
    if not stores:
        stores = ["yes24", "kyobo"]

    for s in stores:
        try:
            probe(s)
        except Exception:  # noqa: BLE001
            sep(f"{s} 탐침 중 예외")
            traceback.print_exc()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
