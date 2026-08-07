"""
헤드리스 브라우저(화면 없는 브라우저) — 교보문고 전용.

【왜 이것만 브라우저를 쓰나요?】
알라딘·예스24 는 HTML 안에 도서 정보가 들어 있어서 그냥 받아오면 됩니다.
교보는 HTML 이 빈 껍데기이고, 브라우저가 자바스크립트를 실행해야 채워집니다.
(2026-08-07 확인: animate-shimmer 250개, 상품 링크 0개)

【대표님 승인 사항 — 2026-08-07】
교보 페이지의 자바스크립트는 데이터를 store.kyobobook.co.kr/api/gw 에서
받아오는데, 이 경로는 교보 robots.txt 가 금지하고 있습니다.
브라우저를 띄우면 이 호출이 자동으로 발생합니다.
이 점을 보고드렸고, 대표님이 "헤드리스 브라우저로 진행" 을 선택하셨습니다.

그래서 아래 예의는 그대로, 또는 더 엄격하게 지킵니다:
  - 신원을 밝히는 User-Agent (기본 크롬 표기 + 우리 표시)
  - 페이지 사이 1.5~2.5초 간격
  - 한 번에 한 페이지만 (동시 접속 없음)
  - 광고·추적 도메인은 아예 차단 (교보 서버 부담과 무관한 요청 제거)
"""

from __future__ import annotations

import random
import time
from types import TracebackType

OUR_TOKEN = "BestsellerTracker/1.0 (+https://github.com/choimog/apple)"

# 도서 수집과 무관한 광고·추적 도메인. 아예 요청하지 않습니다.
# (우리에게도 빠르고, 상대 서버에도 부담이 적습니다)
BLOCK_HOSTS = (
    "googletagmanager.com", "google-analytics.com", "analytics.google.com",
    "doubleclick.net", "clarity.ms", "facebook.net", "ads-twitter.com",
    "analytics.twitter.com", "t.co", "creativecdn.com", "megadata.co.kr",
    "onetag.co.kr", "mediacategory.com", "daangn.com", "veta.naver.com",
    "wcs.naver.com", "wcs.naver.net", "ad.daum.net", "adnxs.com",
    "eigene.io", "toss.im", "datamanager.co.kr", "bing.com", "kakaocdn.net",
    "daumcdn.net", "pstatic.net",
)

# 표지 이미지도 받을 필요가 없습니다. 주소만 읽으면 되기 때문입니다.
# (요구사항: 표지 이미지는 저장하지 않고 주소만 보관)
BLOCK_TYPES = ("image", "media", "font")


class PoliteBrowser:
    """
    한 번에 한 페이지씩, 간격을 두고 여는 브라우저.

    쓰는 법:
        with PoliteBrowser() as b:
            html = b.get("https://...")
    """

    def __init__(
        self,
        delay_min: float = 1.5,
        delay_max: float = 2.5,
        timeout_ms: int = 45_000,
        wait_for: str | None = None,
    ) -> None:
        # 간격은 최소 1초 밑으로 내려가지 않게 강제합니다
        self.delay_min = max(1.0, delay_min)
        self.delay_max = max(self.delay_min, delay_max)
        self.timeout_ms = timeout_ms
        self.wait_for = wait_for
        self._last_at: float | None = None
        self.pages_fetched = 0
        self.blocked_requests = 0

    def __enter__(self) -> "PoliteBrowser":
        from playwright.sync_api import sync_playwright

        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(
            args=["--disable-dev-shm-usage", "--disable-gpu"]
        )

        # 기본 크롬 표기를 읽어와 그 뒤에 우리 표시를 붙입니다.
        probe_ctx = self._browser.new_context()
        default_ua = probe_ctx.new_page().evaluate("navigator.userAgent")
        probe_ctx.close()
        self.user_agent = f"{default_ua} {OUR_TOKEN}"

        self._ctx = self._browser.new_context(
            locale="ko-KR",
            user_agent=self.user_agent,
            viewport={"width": 1440, "height": 2400},
        )
        self._ctx.route("**/*", self._route)
        self._page = self._ctx.new_page()
        return self

    def __exit__(self, exc_type: type[BaseException] | None,
                 exc: BaseException | None,
                 tb: TracebackType | None) -> None:
        try:
            self._browser.close()
        finally:
            self._pw.stop()

    def _route(self, route, request) -> None:
        """광고·추적·이미지 요청을 걸러냅니다."""
        url = request.url
        if request.resource_type in BLOCK_TYPES or any(h in url for h in BLOCK_HOSTS):
            self.blocked_requests += 1
            route.abort()
            return
        route.continue_()

    def _wait_turn(self) -> None:
        """앞 요청과의 간격을 지킵니다."""
        if self._last_at is None:
            return
        gap = random.uniform(self.delay_min, self.delay_max)
        remaining = gap - (time.monotonic() - self._last_at)
        if remaining > 0:
            time.sleep(remaining)

    def get(self, url: str) -> str:
        """페이지 하나를 열고, 그려진 뒤의 HTML 을 돌려줍니다."""
        self._wait_turn()
        self._page.goto(url, wait_until="domcontentloaded", timeout=self.timeout_ms)

        if self.wait_for:
            # 도서가 화면에 나타날 때까지 기다립니다.
            # 안 나타나면 예외가 나고, 호출한 쪽에서 실패로 기록합니다.
            # (요구사항: 조용히 빈 데이터를 저장하지 않는다)
            self._page.wait_for_selector(self.wait_for, timeout=self.timeout_ms)

        html = self._page.content()
        self._last_at = time.monotonic()
        self.pages_fetched += 1
        return html

    def stats_json(self) -> dict:
        return {
            "mode": "headless_browser",
            "pages_fetched": self.pages_fetched,
            "blocked_ad_requests": self.blocked_requests,
            "user_agent": self.user_agent,
        }
