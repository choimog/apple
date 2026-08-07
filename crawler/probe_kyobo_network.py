"""
교보문고 — 브라우저가 실제로 어떤 주소를 부르는지 관찰하는 탐침.

【왜 필요한가요?】
교보 목록 페이지의 HTML 에는 도서 데이터가 없습니다(확인 완료).
= 브라우저가 자바스크립트를 실행해서 어딘가에서 데이터를 받아옵니다.

그런데 교보 robots.txt 는 '/api/gw' 경로를 금지하고 있습니다.
브라우저를 띄우면 페이지가 '자동으로' 데이터를 불러오는데,
그 주소가 금지 경로라면 우리가 직접 부르지 않았더라도
결과적으로 금지된 곳을 요청하게 됩니다.

그래서 코드를 짜기 전에 먼저 눈으로 확인합니다:
  1) 브라우저가 부르는 주소를 전부 기록
  2) 그중 데이터(JSON)를 주는 주소가 어디인지
  3) 그 주소가 robots.txt 상 허용인지 금지인지
  4) 화면이 다 그려진 뒤 도서 칸의 HTML 구조는 어떤 모양인지

※ 요청 1회(목록 페이지 1장)만 보냅니다. 상세 페이지 진입 없음.
"""

from __future__ import annotations

import re
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common.http import PoliteClient  # noqa: E402
from common.robots import parse as parse_robots  # noqa: E402

URL = "https://store.kyobobook.co.kr/bestseller/online/weekly/domestic?page=1"

# 우리를 밝히는 표시. 실제 크롬 UA 뒤에 붙여서 "누가 왔는지" 알 수 있게 합니다.
OUR_TOKEN = "BestsellerTracker/1.0 (+https://github.com/choimog/apple)"

# 도서 데이터라면 들어 있을 법한 표시
BOOK_HINTS = [
    "saleCmdtNm", "cmdtName", "prdtNm", "prodNm", "bookName", "saleCmdtid",
    "cmdtCode", "salePrice", "salesPoint", "author", "저자", "출판사",
]


def sep(t: str) -> None:
    print("\n" + "=" * 70)
    print(f"  {t}")
    print("=" * 70)


def check_robots(url: str, ua: str) -> str:
    """주소 하나가 그 사이트의 robots.txt 상 허용인지 확인합니다."""
    parts = urlsplit(url)
    origin = f"{parts.scheme}://{parts.netloc}"
    try:
        with PoliteClient(user_agent=OUR_TOKEN, delay_min=1.0, delay_max=1.5) as c:
            r = c.get(f"{origin}/robots.txt", allow_status=(404, 403),
                      check_block_markers=False, min_body_len=1)
        if r.status_code != 200:
            return f"robots.txt 없음(HTTP {r.status_code}) → 제한 없음으로 봅니다"
        rules = parse_robots(r.text)
        allowed, why = rules.is_allowed(url, ua)
        return ("✅ 허용 — " if allowed else "🚫 금지 — ") + why
    except Exception as exc:  # noqa: BLE001
        return f"확인 실패: {type(exc).__name__}: {exc}"


def main() -> int:
    from playwright.sync_api import sync_playwright

    calls: list[dict] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--disable-dev-shm-usage"])
        ctx = browser.new_context(
            locale="ko-KR",
            viewport={"width": 1440, "height": 2400},
        )
        # 기본 크롬 UA 뒤에 우리 표시를 붙입니다 (신원을 밝히는 요구사항)
        default_ua = ctx.new_page().evaluate("navigator.userAgent")
        ctx.close()
        ua = f"{default_ua} {OUR_TOKEN}"
        ctx = browser.new_context(
            locale="ko-KR",
            user_agent=ua,
            viewport={"width": 1440, "height": 2400},
        )
        page = ctx.new_page()

        def on_response(resp):
            try:
                calls.append({
                    "url": resp.url,
                    "status": resp.status,
                    "type": resp.request.resource_type,
                    "method": resp.request.method,
                })
            except Exception:  # noqa: BLE001
                pass

        page.on("response", on_response)

        print(f"UA: {ua}\n")
        page.goto(URL, wait_until="domcontentloaded", timeout=60_000)

        # 도서가 다 그려질 때까지 기다립니다.
        # 교보 상품 주소는 product.kyobobook.co.kr/detail/S... 형태입니다.
        try:
            page.wait_for_selector("a[href*='/detail/S']", timeout=30_000)
            print("✅ 상품 링크가 화면에 나타났습니다.")
        except Exception:  # noqa: BLE001
            print("⚠️ 상품 링크를 30초 안에 못 찾았습니다. 현재 상태 그대로 분석합니다.")

        page.wait_for_timeout(3_000)
        html = page.content()
        browser.close()

    print(f"\n렌더링 후 HTML 길이: {len(html):,}자")

    # ---------------------------------------------------------------
    sep("1. 브라우저가 부른 주소 — 데이터(XHR/fetch) 만")
    # ---------------------------------------------------------------
    data_calls = [c for c in calls
                  if c["type"] in ("xhr", "fetch") or ".json" in c["url"]]
    if not data_calls:
        print("  (데이터 요청이 잡히지 않았습니다)")
    for c in data_calls:
        print(f"  [{c['status']}] {c['method']:<5} {c['url'][:160]}")

    # ---------------------------------------------------------------
    sep("2. 금지 경로(/api/gw) 를 부르는가")
    # ---------------------------------------------------------------
    gw = [c for c in calls if "/api/gw" in c["url"]]
    if gw:
        print(f"  🚨 /api/gw 요청 {len(gw)}건 발생 — robots.txt 금지 경로입니다.")
        for c in gw[:10]:
            print(f"     [{c['status']}] {c['url'][:160]}")
    else:
        print("  ✅ /api/gw 요청 없음")

    # ---------------------------------------------------------------
    sep("3. 데이터 주소별 robots.txt 판정")
    # ---------------------------------------------------------------
    seen_paths: set[str] = set()
    for c in data_calls[:40]:
        parts = urlsplit(c["url"])
        sig = f"{parts.netloc}{parts.path}"
        if sig in seen_paths:
            continue
        seen_paths.add(sig)
        print(f"\n  {sig}")
        print(f"    {check_robots(c['url'], OUR_TOKEN)}")

    # ---------------------------------------------------------------
    sep("4. 접속한 호스트 목록")
    # ---------------------------------------------------------------
    for host, n in Counter(urlsplit(c["url"]).netloc for c in calls).most_common():
        print(f"  {n:>3}회  {host}")

    # ---------------------------------------------------------------
    sep("5. 렌더링된 화면에 도서가 있는가")
    # ---------------------------------------------------------------
    prod_links = re.findall(r'href="([^"]*?/detail/S\d+[^"]*)"', html)
    print(f"  상품 링크(/detail/S...): {len(set(prod_links))}개")
    for u in list(dict.fromkeys(prod_links))[:3]:
        print(f"    {u}")

    covers = re.findall(r'src="(https://contents\.kyobobook\.co\.kr/[^"]+)"', html)
    covers = [c for c in covers if "/pdt/" in c or "/sih/" in c]
    print(f"  표지 후보 이미지: {len(set(covers))}개")
    for u in list(dict.fromkeys(covers))[:3]:
        print(f"    {u}")

    shimmer = len(re.findall(r"animate-shimmer", html))
    print(f"  남아 있는 로딩 뼈대: {shimmer}개 (0에 가까울수록 완전히 그려진 상태)")

    # ---------------------------------------------------------------
    sep("6. 도서 칸 후보 (반복되는 class 조합)")
    # ---------------------------------------------------------------
    for cls, n in Counter(re.findall(r'class="([^"]{10,120})"', html)).most_common(20):
        mark = "  ← 페이지당 권수일 가능성" if 15 <= n <= 60 else ""
        print(f"  {n:>4}회  {cls[:95]}{mark}")

    # ---------------------------------------------------------------
    sep("7. 첫 번째 도서 칸 HTML (선택자 설계용)")
    # ---------------------------------------------------------------
    m = re.search(r'href="[^"]*?/detail/S\d+', html)
    if m:
        start = max(0, m.start() - 3000)
        print(html[start:m.start() + 2500])
    else:
        print("  (상품 링크를 못 찾아 생략)")

    # ---------------------------------------------------------------
    sep("결론")
    # ---------------------------------------------------------------
    if gw:
        print("  🚨 페이지가 robots.txt 금지 경로(/api/gw)를 호출합니다.")
        print("     → 헤드리스 브라우저를 쓰면 결과적으로 금지 경로를 요청하게 됩니다.")
        print("     → 임의로 진행하지 않고 사용자에게 보고합니다.")
    elif prod_links:
        print("  ✅ 금지 경로 호출 없이 도서가 정상적으로 그려졌습니다.")
        print("     → 헤드리스 브라우저 방식으로 교보 수집이 가능합니다.")
    else:
        print("  ⚠️ 도서가 그려지지 않았습니다. 위 로그를 보고 원인을 찾아야 합니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
