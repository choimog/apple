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

# 이미지는 브라우저 설정으로 아예 끕니다 (--blink-settings=imagesEnabled=false).
#
# 【왜 이렇게 하나요? — 2026-08-07 실측】
# 처음에는 모든 요청을 가로채서(route) 이미지에 가짜 응답을 돌려줬습니다.
# 그런데 per=200 으로 한 페이지에 200권이 담기자, 이미지 요청 200건이
# 전부 파이썬 함수를 거치면서 페이지 한 장이 60초를 넘겨 실패했습니다.
# (설정 점검에서 교보 29개가 '45초 초과' 로 실패)
#
# 같은 페이지를 세 방식으로 재본 결과:
#     A) 전부 가로채기 + 가짜 응답 :  6.2초 / 3.8초 / 60.5초 실패
#     B) 가로채기 없음             :  5.2초 / 3.3초 / 3.3초
#     C) 이미지를 브라우저에서 끄기   :  4.1초 / 2.9초 / 3.0초  ← 채택
# 세 방식 모두 도서 200권·표지ISBN 200개를 얻었습니다.
#
# C 가 가장 빠르고, 이미지를 아예 안 받으므로 서점 대역폭도 안 씁니다.
# 그리고 중요한 점: 이미지를 '끄면' 표지 주소가 그대로 남습니다.
# (예전에 route.abort() 로 막았을 때는 교보 화면이 표지 주소를
#  '등록된 이미지 없음' 자리표시자로 바꿔버려 ISBN 을 잃었습니다)


class PageRenderTimeout(RuntimeError):
    """
    정해진 시간 안에 도서 목록이 화면에 안 그려졌을 때.

    【왜 따로 만들었나요? — 2026-08-08 실제 사고】
    교보는 목록이 끝난 페이지를 열어도 '도서가 0권' 이라고 알려주지 않고,
    그냥 도서 칸을 영영 안 그립니다. 그러면 우리 쪽에서는 시간 초과가 납니다.
    이걸 '고장' 으로 처리했더니, 이미 잘 받아 둔 앞 페이지까지 통째로 버리고
    분야 14개가 매번 똑같이 실패했습니다.

    그래서 이 예외를 따로 두고, 수집 쪽에서
    "앞 페이지는 받았는데 뒷 페이지가 안 그려진다 = 목록이 끝난 것"
    으로 판단할 수 있게 합니다.
    """


class _Response:
    """PoliteClient(보통 방식) 와 똑같이 생긴 응답. 수집 코드를 공유하기 위함입니다."""

    def __init__(self, text: str, url: str) -> None:
        self.text = text
        self.url = url
        self.status_code = 200


class _Stats:
    """PoliteClient 의 stats 와 똑같은 모양을 흉내 냅니다."""

    def __init__(self, owner: "PoliteBrowser") -> None:
        self._owner = owner

    def to_json(self) -> dict:
        return self._owner.stats_json()


class PoliteBrowser:
    """
    한 번에 한 페이지씩, 간격을 두고 여는 브라우저.

    보통 방식(PoliteClient)과 사용법이 같습니다:
        with PoliteBrowser() as b:
            html = b.get("https://...").text
    """

    def __init__(
        self,
        delay_min: float = 1.5,
        delay_max: float = 2.5,
        timeout_ms: int = 30_000,
        wait_for: str | None = None,
        max_retries: int = 3,
    ) -> None:
        # 간격은 최소 1초 밑으로 내려가지 않게 강제합니다
        self.delay_min = max(1.0, delay_min)
        self.delay_max = max(self.delay_min, delay_max)
        self.timeout_ms = timeout_ms
        self.wait_for = wait_for
        self._last_at: float | None = None
        self.max_retries = max(1, max_retries)
        self.pages_fetched = 0
        self.retried_pages = 0
        self.blocked_requests = 0
        self.stats = _Stats(self)
        self.user_agent = OUR_TOKEN

    def __enter__(self) -> "PoliteBrowser":
        from playwright.sync_api import sync_playwright

        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(args=[
            "--disable-dev-shm-usage",
            "--disable-gpu",
            # 이미지를 아예 받지 않습니다. 위 주석의 실측 근거를 보세요.
            "--blink-settings=imagesEnabled=false",
        ])

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
        # 광고·추적만 막습니다. 요청 수가 적어(페이지당 5~6건) 병목이 안 됩니다.
        # ※ 여기서 "**/*" 로 전부 가로채면 안 됩니다. 그게 60초 실패의 원인이었습니다.
        for host in BLOCK_HOSTS:
            self._ctx.route(f"**://*{host}/**", self._block)
        self._page = self._ctx.new_page()
        return self

    def __exit__(self, exc_type: type[BaseException] | None,
                 exc: BaseException | None,
                 tb: TracebackType | None) -> None:
        try:
            self._browser.close()
        finally:
            self._pw.stop()

    def _block(self, route, request) -> None:
        """광고·추적 요청을 막습니다. (이미지는 브라우저 설정으로 이미 꺼져 있습니다)"""
        self.blocked_requests += 1
        route.abort()

    def _wait_turn(self) -> None:
        """앞 요청과의 간격을 지킵니다."""
        if self._last_at is None:
            return
        gap = random.uniform(self.delay_min, self.delay_max)
        remaining = gap - (time.monotonic() - self._last_at)
        if remaining > 0:
            time.sleep(remaining)

    def get(self, url: str, **_ignored) -> _Response:
        """
        페이지 하나를 열고, 그려진 뒤의 HTML 을 돌려줍니다.

        【다시 시도하는 이유 — 2026-08-07 실측】
        같은 페이지가 보통 3초면 그려지는데, 가끔 시간 초과가 납니다.
        122개를 점검했을 때 3개가 그랬고, 매번 다른 항목이었습니다.
        = 그 분야가 잘못된 게 아니라 일시적인 현상입니다.
        그래서 한 번 실패했다고 포기하지 않고 몇 번 더 시도합니다.

        끝까지 안 되면 예외를 냅니다. 조용히 빈 데이터를 돌려주지 않습니다.
        """
        last_error: Exception | None = None

        for attempt in range(1, self.max_retries + 1):
            self._wait_turn()
            try:
                self._page.goto(url, wait_until="domcontentloaded",
                                timeout=self.timeout_ms)
                if self.wait_for:
                    # 도서가 화면에 나타날 때까지 기다립니다.
                    self._page.wait_for_selector(
                        self.wait_for, timeout=self.timeout_ms
                    )
                html = self._page.content()
                self._last_at = time.monotonic()
                self.pages_fetched += 1
                if attempt > 1:
                    self.retried_pages += 1
                    print(f"      (다시 시도 {attempt}번째에 성공)")
                return _Response(html, url)

            except Exception as exc:  # noqa: BLE001
                last_error = exc
                self._last_at = time.monotonic()
                if attempt < self.max_retries:
                    wait = 3 * attempt   # 3초, 6초… 점점 길게 쉽니다
                    print(f"      ⏳ {type(exc).__name__} — "
                          f"{wait}초 쉬고 다시 시도 ({attempt}/{self.max_retries})")
                    time.sleep(wait)

        raise PageRenderTimeout(
            f"{self.max_retries}번 시도했지만 화면이 안 그려졌습니다: "
            f"{type(last_error).__name__}"
        ) from last_error

    def stats_json(self) -> dict:
        return {
            "mode": "headless_browser",
            "pages_fetched": self.pages_fetched,
            "retried_pages": self.retried_pages,
            "blocked_ad_requests": self.blocked_requests,
            "images": "브라우저 설정으로 끔",
            "user_agent": self.user_agent,
        }
