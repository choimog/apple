"""
=============================================================================
 알라딘 차단 탐침 — "무엇이 막고 있는가" 를 가릅니다
=============================================================================

 【왜 이걸 먼저 하나요? — 2026-10-20】
 10월 16일부터 알라딘 61개 분야가 전부 HTTP 403 입니다.
 코드는 9월 1일 이후 안 바뀌었고, 같은 컴퓨터·같은 분에 교보·예스24 는
 정상이었습니다. 즉 상대가 우리를 문턱에서 거절하고 있습니다.

 거절의 '층' 이 세 가지일 수 있고, 층마다 할 일이 완전히 다릅니다.

   ① 이름표(User-Agent) 때문   → 이름표만 바꾸면 됩니다 (브라우저 불필요)
   ② 브라우저가 아니라서        → 교보처럼 진짜 브라우저로 열면 됩니다
   ③ 주소(IP) 대역 자체         → 🚨 브라우저로도 못 뚫습니다. 보고가 답입니다

 코드를 먼저 고치고 하루 기다려 보는 것은 순서가 아닙니다.
 그래서 다섯 번의 요청으로 ①②③ 중 어디인지만 알아냅니다.

 【예의】
  - 요청 총 5건. 사이에 2초씩 쉽니다.
  - 목록 페이지와 robots.txt 만. 도서 상세 페이지 진입 없음.
  - 어떤 방식이든 우리 신원(BestsellerTracker)을 UA 에 그대로 붙입니다.
    신원을 지우고 일반 소비자인 척하지 않습니다 (대표님께 따로 여쭐 사안).

 실행: Actions → [알라딘 차단 탐침] → Run workflow
=============================================================================
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import httpx
from selectolax.parser import HTMLParser

sys.path.insert(0, str(Path(__file__).resolve().parent))

OUR_TOKEN = "BestsellerTracker/1.0 (+https://github.com/choimog/apple)"

# 현재 수집기가 쓰는 이름표 (config/sources.yaml 의 defaults.user_agent)
OURS_ONLY = OUR_TOKEN

# 크롬 표기 + 우리 신원. 교보에 쓰는 방식과 같습니다.
CHROME = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
)
CHROME_PLUS_OURS = f"{CHROME} {OUR_TOKEN}"

ROBOTS = "https://www.aladin.co.kr/robots.txt"
LIST_URL = (
    "https://www.aladin.co.kr/shop/common/wbest.aspx"
    "?BestType=DailyBest&BranchType=1&CID=0&page=1"
)
BOOK_BOX = "div.ss_book_box"   # config/selectors.yaml 의 aladin.book_box

GAP_SEC = 2.0


def line() -> None:
    print("=" * 66)


def books_in(html: str) -> int:
    """받아온 HTML 에 도서 칸이 몇 개 있는지. 0 이면 내용이 없는 것입니다."""
    try:
        return len(HTMLParser(html).css(BOOK_BOX))
    except Exception:  # noqa: BLE001
        return 0


def show(label: str, status: int | None, body: str,
         *, expect_books: bool = True) -> bool:
    """
    한 번의 시도 결과를 사람이 읽을 수 있게 적습니다.
    돌려주는 값: 이 시도가 성공인가

    expect_books: 도서 칸이 있어야 하는 응답인가.
      ⚠️ robots.txt 는 글 파일이라 도서 칸이 있을 수 없습니다. False 로 줍니다.
         (2026-10-20 첫 실행에서 robots.txt 에 '도서 0개 🚨' 가 떴습니다.
          멀쩡한데 뜨는 경고는 안 뜨는 경고와 같습니다 — 다음에 진짜
          경고가 떠도 그냥 넘기게 됩니다)
    """
    if not expect_books:
        ok = status == 200 and len(body) > 0
        print(f"  {'✅' if ok else '❌'} {label}")
        print(f"       HTTP {status}  ·  받은 글자 {len(body):,}")
        return ok

    n = books_in(body)
    ok = status == 200 and n > 0
    mark = "✅" if ok else ("⚠️" if status == 200 else "❌")
    print(f"  {mark} {label}")
    print(f"       HTTP {status}  ·  받은 글자 {len(body):,}  ·  도서 칸 {n}개")
    # 🚨 200 인데 도서가 0개면 '통과한 척' 입니다. 가장 위험한 결과라 따로 적습니다.
    if status == 200 and n == 0:
        print("       🚨 열리기는 했지만 도서가 0개입니다 "
              "— 차단 안내 페이지일 수 있습니다")
    return ok


def try_httpx(label: str, ua: str, url: str, *,
              browser_headers: bool, expect_books: bool = True) -> bool:
    """
    보통 방식(httpx)으로 한 번 받아 봅니다.

    browser_headers: 크롬이 늘 함께 보내는 머리글을 흉내 냅니다.
      이름표만 바꿔도 되는지, 머리글까지 봐야 하는지를 가르기 위한 것입니다.
    """
    headers = {"User-Agent": ua}
    if browser_headers:
        headers.update({
            "Accept": "text/html,application/xhtml+xml,application/xml;"
                      "q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
            "Referer": "https://www.aladin.co.kr/",
        })
    try:
        with httpx.Client(timeout=20.0, follow_redirects=True) as c:
            r = c.get(url, headers=headers)
        return show(label, r.status_code, r.text, expect_books=expect_books)
    except Exception as exc:  # noqa: BLE001
        print(f"  ❌ {label}")
        print(f"       접속 자체가 안 됐습니다: {type(exc).__name__}: {exc}")
        return False


def try_browser() -> tuple[bool, bool]:
    """
    진짜 브라우저(화면 없는 크롬)로 엽니다. 교보에 쓰는 것과 같은 방식입니다.
    돌려주는 값: (robots.txt 가 열렸나, 목록에서 도서를 받았나)
    """
    from playwright.sync_api import sync_playwright

    pw = sync_playwright().start()
    browser = pw.chromium.launch(args=[
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--blink-settings=imagesEnabled=false",
    ])
    try:
        # 교보와 똑같이, 크롬 기본 표기 뒤에 우리 신원을 붙입니다.
        probe = browser.new_context()
        default_ua = probe.new_page().evaluate("navigator.userAgent")
        probe.close()
        ua = f"{default_ua} {OUR_TOKEN}"
        print(f"  · 브라우저가 쓰는 이름표: {ua}")

        ctx = browser.new_context(
            locale="ko-KR", user_agent=ua,
            viewport={"width": 1440, "height": 2400},
        )
        page = ctx.new_page()

        resp = page.goto(ROBOTS, wait_until="domcontentloaded", timeout=30_000)
        robots_ok = show("브라우저로 robots.txt",
                         resp.status if resp else None,
                         page.content(), expect_books=False)

        time.sleep(GAP_SEC)

        resp = page.goto(LIST_URL, wait_until="domcontentloaded", timeout=30_000)
        status = resp.status if resp else None
        html = page.content()
        list_ok = show("브라우저로 목록 페이지", status, html)
        return robots_ok, list_ok
    finally:
        browser.close()
        pw.stop()


def main() -> int:
    line()
    print("  알라딘 차단 탐침 — 무엇이 막고 있는지 가립니다")
    print("  ※ 요청 5건 · 2초 간격 · 목록 페이지와 robots.txt 만")
    line()
    print()

    print("[1] 지금 수집기가 쓰는 방식 (httpx + 우리 이름표만)")
    print("    여기서 403 이 나와야 '로그에서 본 그 증상' 과 같은 것입니다.")
    a_robots = try_httpx("robots.txt", OURS_ONLY, ROBOTS,
                         browser_headers=False, expect_books=False)
    time.sleep(GAP_SEC)
    a_list = try_httpx("목록 페이지", OURS_ONLY, LIST_URL, browser_headers=False)
    print()

    print("[2] 이름표만 크롬으로 바꿔 보기 (+ 우리 신원 유지)")
    print("    이게 통하면 브라우저가 필요 없습니다 — 가장 가벼운 해결입니다.")
    time.sleep(GAP_SEC)
    b_list = try_httpx("목록 페이지", CHROME_PLUS_OURS, LIST_URL,
                       browser_headers=True)
    print()

    print("[3] 진짜 브라우저로 열기 (교보에 쓰는 방식)")
    time.sleep(GAP_SEC)
    try:
        c_robots, c_list = try_browser()
    except Exception as exc:  # noqa: BLE001
        print(f"  ❌ 브라우저를 띄우지 못했습니다: {type(exc).__name__}: {exc}")
        c_robots = c_list = False
    print()

    # ---------------------------------------------------------------- 판정
    line()
    print("  판정")
    line()
    if a_list:
        print("  🤔 지금 이 순간에는 **안 막혀 있습니다.** 지금 쓰는 방식 그대로 통과했습니다.")
        print()
        print("     즉 '이름표가 잘못됐다' 거나 '브라우저가 아니라서' 가 아닙니다.")
        print("     수집이 403 이던 시각과 이 탐침이 200 인 시각이 다를 뿐입니다.")
        print("     = 간헐적 차단입니다. 작업마다 받는 서버 주소(IP)에 따라 갈립니다.")
        print()
        print("     🚨 그래서 '우회' 가 할 일이 아닙니다. 같은 작업 안에서는 이미")
        print("        4번 재시도하지만 주소가 그대로라 안 뚫립니다. 필요한 것은")
        print("        **새 작업(=새 주소)에서 다시 받기** 입니다.")
        print()
        print("     지금 할 일: [매일 수집] 을 store=aladin 으로 수동 실행해서")
        print("     오늘 자료를 건지세요. 서점은 '오늘' 순위만 보여주므로")
        print("     지나가면 영영 못 받습니다.")
        verdict = "intermittent"
    elif b_list:
        print("  ✅ ① 이름표 때문이었습니다.")
        print("     브라우저가 필요 없습니다. 알라딘에만 크롬 표기를 쓰면 됩니다.")
        print("     (우리 신원은 뒤에 그대로 붙어 있습니다)")
        verdict = "ua"
    elif c_list:
        print("  ✅ ② 브라우저가 아니라서 막힌 것이었습니다.")
        print("     교보와 같은 방식(화면 없는 브라우저)으로 바꾸면 됩니다.")
        print("     수집 시간이 늘어납니다 (교보가 40분대인 것과 같은 이유).")
        verdict = "browser"
    else:
        print("  🚨 ③ 주소(IP) 대역 수준 차단으로 보입니다.")
        print("     브라우저로도, 이름표를 바꿔도 거절당했습니다.")
        print("     깃허브 서버에서 나가는 접속 자체를 막는 것이므로,")
        print("     코드로 뚫을 수 있는 것이 아닙니다.")
        print()
        print("     다음 수단은 둘뿐입니다:")
        print("       ㉮ 알라딘에 문의해서 허용을 받는다")
        print("       ㉯ 다른 곳(집·사무실 망)에서 수집한다 → 'PC 없이 돌아간다'")
        print("          는 원칙과 어긋나므로 대표님 결정이 필요합니다")
        verdict = "ip"

    print()
    print(f"  robots.txt 가 열렸나:  보통 방식 {'O' if a_robots else 'X'}"
          f"  ·  브라우저 {'O' if c_robots else 'X'}")
    print("  ※ robots.txt 가 403 이면 '규칙 위반' 이 아니라 '주소 통째로 거절'")
    print("     입니다. 안내문이 '안내문을 보지 마라' 라고 할 수는 없으니까요.")
    line()
    print(f"VERDICT={verdict}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
