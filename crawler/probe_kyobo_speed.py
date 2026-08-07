"""
교보 페이지가 왜 느린지 실측하는 탐침.

【배경】
per=200 으로 바꾼 뒤 설정 점검에서 교보 29개가 '45초 시간 초과' 로 실패했다.
주소는 정상이다(성공한 매장은 199~200권을 제대로 읽었다).

의심: 우리 쪽 '이미지 가로채기' 가 병목이다.
한 페이지에 이미지 요청이 200건인데, 그걸 전부 파이썬 함수로 넘겨
하나씩 처리하고 있다. 200번의 왕복이 수십 초를 먹을 수 있다.

【무엇을 재나요?】
같은 페이지를 세 가지 방식으로 열어 시간을 잽니다.
  A) 지금 방식      : 모든 요청을 가로채고 이미지는 가짜로 응답
  B) 가로채기 없음   : 그냥 다 받음 (가장 빠르지만 이미지 대역폭을 씀)
  C) 브라우저 설정으로 이미지 끄기 : 가로채기 없이 이미지만 안 받음

C 가 되면 가장 좋습니다. 빠르면서 이미지 대역폭도 안 씁니다.
다만 이미지를 끄면 표지 주소(=ISBN)가 사라질 수 있어서 그것도 함께 봅니다.
"""

from __future__ import annotations

import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common.browser import BLOCK_HOSTS, OUR_TOKEN, TINY_GIF  # noqa: E402

URLS = [
    ("온라인 전체", "https://store.kyobobook.co.kr/bestseller/online/daily/domestic?page=1&per=200"),
    ("온라인 소설", "https://store.kyobobook.co.kr/bestseller/online/daily/domestic/01?page=1&per=200"),
    ("광화문점",   "https://store.kyobobook.co.kr/bestseller/store/seoul/001/00?page=1&per=200"),
]
WAIT_FOR = "a[href*='/detail/S']"
COVER_RE = re.compile(r"contents\.kyobobook\.co\.kr/sih/[^\"']*?/pdt/(\d{13})")


def analyse(html: str) -> tuple[int, int]:
    """(도서 수, ISBN 이 담긴 표지 주소 수)"""
    books = len(set(re.findall(r"/detail/S\d{9,}", html)))
    isbns = len(set(COVER_RE.findall(html)))
    return books, isbns


def run(mode: str, label: str) -> None:
    from playwright.sync_api import sync_playwright

    print(f"\n{'=' * 70}\n  {label}\n{'=' * 70}")

    args = ["--disable-dev-shm-usage", "--disable-gpu"]
    if mode == "C":
        # 브라우저 자체 설정으로 이미지를 안 받게 합니다 (가로채기 없음)
        args.append("--blink-settings=imagesEnabled=false")

    with sync_playwright() as p:
        browser = p.chromium.launch(args=args)
        ctx = browser.new_context(
            locale="ko-KR",
            user_agent=f"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                       f"(KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36 {OUR_TOKEN}",
            viewport={"width": 1440, "height": 1080},
        )

        stats = {"routed": 0}

        if mode == "A":
            def handler(route, request):
                stats["routed"] += 1
                url = request.url
                if request.resource_type in ("media", "font") or any(
                    h in url for h in BLOCK_HOSTS
                ):
                    route.abort()
                    return
                if request.resource_type == "image":
                    route.fulfill(status=200, content_type="image/gif", body=TINY_GIF)
                    return
                route.continue_()

            ctx.route("**/*", handler)

        elif mode == "C":
            # 광고·추적만 막습니다. 요청 수가 적어 병목이 안 됩니다.
            def ad_handler(route, request):
                stats["routed"] += 1
                route.abort()

            for host in ("googletagmanager.com", "doubleclick.net", "clarity.ms",
                         "facebook.net", "creativecdn.com", "megadata.co.kr",
                         "mediacategory.com", "daangn.com", "adnxs.com"):
                ctx.route(f"**://*{host}/**", ad_handler)

        page = ctx.new_page()
        for name, url in URLS:
            stats["routed"] = 0
            t0 = time.monotonic()
            ok = True
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=60_000)
                page.wait_for_selector(WAIT_FOR, timeout=60_000)
                html = page.content()
            except Exception as exc:  # noqa: BLE001
                ok = False
                html = ""
                err = f"{type(exc).__name__}"
            elapsed = time.monotonic() - t0

            if ok:
                books, isbns = analyse(html)
                mark = "✅" if books > 0 else "❌"
                print(f"  {mark} {name:<12} {elapsed:6.1f}초  "
                      f"도서 {books:>3}권  표지-ISBN {isbns:>3}개  "
                      f"가로챈요청 {stats['routed']}")
            else:
                print(f"  ❌ {name:<12} {elapsed:6.1f}초  실패({err})  "
                      f"가로챈요청 {stats['routed']}")
            time.sleep(1.5)

        browser.close()


def main() -> int:
    run("A", "A) 지금 방식 — 모든 요청 가로채기 + 이미지 가짜 응답")
    run("B", "B) 가로채기 없음 — 이미지까지 전부 실제로 받음")
    run("C", "C) 브라우저 설정으로 이미지 끄기 (광고만 가로챔)")

    print(f"\n{'=' * 70}\n  판단 기준\n{'=' * 70}")
    print("  · 시간이 가장 짧으면서")
    print("  · 도서 수가 200권 가까이 나오고")
    print("  · 표지-ISBN 개수가 도서 수만큼 나오는 방식을 고릅니다.")
    print("  ※ 표지-ISBN 이 0이면 그 방식은 못 씁니다 (ISBN 을 잃습니다).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
