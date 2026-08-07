"""
분야 코드 · 교보 매장 코드 · 최대 수집 가능 권수를 한 번에 알아내는 탐침.

【왜 필요한가요?】
지금 수집 중인 분야는 서점별로 일부뿐이고, 교보 매장도 4곳뿐입니다.
대표님 요구는 "모든 매장 / 분야당 1,000권" 이므로 나머지를 찾아야 합니다.

【출력을 짧게 유지하는 이유】
1차 시도에서 붙여넣기용 YAML 을 통째로 찍었더니 로그가 잘려서
정작 목록 앞부분을 못 봤습니다. 그래서 코드+이름만 한 줄씩 찍습니다.

※ 목록 페이지만 봅니다. 상세 페이지 진입 없음.
※ 교보는 화면이 자바스크립트로 그려지므로 브라우저를 씁니다.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common.http import PoliteClient  # noqa: E402

from selectolax.parser import HTMLParser  # noqa: E402

UA = "BestsellerTracker/1.0 (+https://github.com/choimog/apple)"


def sep(t: str) -> None:
    print("\n" + "=" * 72)
    print(f"  {t}")
    print("=" * 72)


def clean(s: str | None) -> str:
    return " ".join((s or "").split())


def dump(title: str, items: dict[str, str]) -> None:
    """코드→이름 을 한 줄씩. 로그가 잘리지 않게 짧게."""
    print(f"\n[{title}] {len(items)}개")
    for code, name in items.items():
        print(f"  {code:>8} | {name}")


# =============================================================================
#  알라딘
# =============================================================================
def probe_aladin(client: PoliteClient) -> None:
    sep("알라딘 분야")
    html = client.get(
        "https://www.aladin.co.kr/shop/common/wbest.aspx?BranchType=1"
    ).text
    tree = HTMLParser(html)

    cats: dict[str, str] = {}
    for a in tree.css("a"):
        href = a.attributes.get("href") or ""
        m = re.search(r"[?&]CID=(\d+)", href)
        if m and "wbest" in href.lower() and m.group(1) != "0":
            name = clean(a.text())
            if name and len(name) < 20:
                cats.setdefault(m.group(1), name)

    dump("알라딘 분야", dict(sorted(cats.items(), key=lambda x: int(x[0]))))

    # 한 분야가 몇 권까지 되는지
    print("\n[최대 권수] 뒤쪽 페이지에 도서가 있는지 확인")
    for page in (20, 21, 40):
        h = client.get(
            "https://www.aladin.co.kr/shop/common/wbest.aspx"
            f"?BranchType=1&page={page}"
        ).text
        n = len(HTMLParser(h).css("div.ss_book_box"))
        print(f"  page {page:>3}: {n}권")
        if n == 0:
            break


# =============================================================================
#  예스24
# =============================================================================
def probe_yes24(client: PoliteClient) -> None:
    sep("예스24 분야")
    html = client.get(
        "https://www.yes24.com/product/category/bestseller?categoryNumber=001"
    ).text

    # 1차 시도에서 <a> 만 봤더니 1개밖에 못 찾았습니다.
    # 분야 메뉴가 링크가 아닐 수 있으므로 본문 전체에서 코드를 긁습니다.
    codes = set(re.findall(r"categoryNumber=(\d{3,})", unquote(html)))
    print(f"\n본문 전체에서 찾은 분야 코드: {len(codes)}개")
    print(f"  {sorted(codes)}")

    # 이름은 링크에서 얻어 봅니다
    tree = HTMLParser(html)
    named: dict[str, str] = {}
    for a in tree.css("a"):
        href = unquote(a.attributes.get("href") or "")
        m = re.search(r"categoryNumber=(\d{3,})", href)
        if m:
            name = clean(a.text())
            if name and len(name) < 20:
                named.setdefault(m.group(1), name)
    dump("이름까지 확인된 분야", named)

    # 분야 메뉴가 어떤 태그로 돼 있는지 직접 봅니다 (다음에 고치기 위해)
    print("\n[분야 메뉴 구조 확인] 'categoryNumber' 주변 500자")
    i = html.find("categoryNumber")
    if i > 0:
        print(html[max(0, i - 250): i + 250].replace("\n", " ")[:500])

    print("\n[최대 권수] 뒤쪽 페이지 확인")
    for page in (9, 10, 20):
        h = client.get(
            "https://www.yes24.com/product/category/bestseller"
            f"?categoryNumber=001&pageNumber={page}&pageSize=120"
        ).text
        n = len(HTMLParser(h).css("div.itemUnit"))
        print(f"  page {page:>3}: {n}권")
        if n == 0:
            break


# =============================================================================
#  교보문고
# =============================================================================
def probe_kyobo() -> None:
    from common.browser import PoliteBrowser

    sep("교보문고")

    with PoliteBrowser(wait_for="a[href*='/detail/S']") as b:
        html = b.get(
            "https://store.kyobobook.co.kr/bestseller/online/weekly/domestic"
        ).text

        # ---- 온라인 분야: 링크가 아닐 수 있으므로 본문 전체에서 ----
        codes = sorted(set(re.findall(
            r"/bestseller/online/weekly/domestic/(\d+)", html
        )))
        print(f"\n[온라인 분야] 본문에서 코드 {len(codes)}개: {codes}")

        # 화면에 심어진 데이터(RSC)에서 분야 이름을 찾아봅니다
        chunks = re.findall(
            r'self\.__next_f\.push\(\[\d+,\s*"((?:[^"\\]|\\.)*)"\]\)', html
        )
        merged = ""
        for ch in chunks:
            try:
                merged += json.loads(f'"{ch}"')
            except Exception:  # noqa: BLE001
                merged += ch
        print(f"  화면에 심어진 데이터 {len(merged):,}자")
        for key in ("categoryNm", "catgNm", "categoryName", "dispNm", "menuNm"):
            n = merged.count(key)
            if n:
                print(f"    '{key}' {n}회 발견")

        # ---- 온라인 최대 권수 ----
        print("\n[온라인 최대 권수] 뒤쪽 페이지 확인")
        last_ok = 0
        for page in (26, 50, 51, 100):
            try:
                h = b.get(
                    "https://store.kyobobook.co.kr/bestseller/online/weekly/"
                    f"domestic?page={page}"
                ).text
                n = len(set(re.findall(r"/detail/S\d{9,}", h)))
            except Exception:  # noqa: BLE001
                n = 0
            print(f"  page {page:>4}: {n}권")
            if n == 0:
                break
            last_ok = page
        print(f"  → 최소 {last_ok * 20}권까지 수집 가능")

        # ---- 오프라인 매장 ----
        html = b.get(
            "https://store.kyobobook.co.kr/bestseller/store/seoul/001/00"
        ).text

    pairs = sorted(set(re.findall(r"/bestseller/store/([a-z]+)/(\d+)", html)))
    print(f"\n[오프라인 매장] 본문에서 {len(pairs)}곳 발견")
    for region, code in pairs:
        print(f"  {region}/{code}")

    # 매장 이름은 화면에 심어진 데이터에 있을 수 있습니다
    for key in ("매장", "점", "storeNm", "branchNm", "shopNm"):
        n = html.count(key)
        if n:
            print(f"  본문에 '{key}' {n}회")

    # 매장 선택 목록이 통째로 들어 있는지 확인
    print("\n[매장 이름 찾기] '점' 으로 끝나는 짧은 단어들")
    names = sorted(set(re.findall(r'"([가-힣A-Za-z0-9]{2,10}점)"', html)))
    print(f"  {len(names)}개: {names[:60]}")


def main() -> int:
    only = (sys.argv[1] if len(sys.argv) > 1 else "").strip()

    with PoliteClient(user_agent=UA, delay_min=1.5, delay_max=2.5,
                      timeout=25) as client:
        if not only or "aladin" in only:
            try:
                probe_aladin(client)
            except Exception as exc:  # noqa: BLE001
                print(f"\n❌ 알라딘 실패: {type(exc).__name__}: {exc}")

        if not only or "yes24" in only:
            try:
                probe_yes24(client)
            except Exception as exc:  # noqa: BLE001
                print(f"\n❌ 예스24 실패: {type(exc).__name__}: {exc}")

    if not only or "kyobo" in only:
        try:
            probe_kyobo()
        except Exception as exc:  # noqa: BLE001
            print(f"\n❌ 교보 실패: {type(exc).__name__}: {exc}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
