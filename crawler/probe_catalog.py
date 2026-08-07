"""
분야 코드 · 교보 매장 코드 · 최대 수집 가능 권수를 한 번에 알아내는 탐침.

【왜 필요한가요?】
지금 수집 중인 분야는 서점별로 일부뿐이고, 교보 매장도 4곳뿐입니다.
대표님 요구는 "모든 매장 / 분야당 1,000권" 이므로 나머지를 찾아야 합니다.

손으로 하나씩 찾으면 실수하기 쉬우니, 서점 화면에서 직접 읽어옵니다.
결과는 config/sources.yaml 에 **그대로 붙여넣을 수 있는 형태**로 출력합니다.

※ 목록 페이지만 봅니다. 상세 페이지 진입 없음.
※ 교보는 화면이 자바스크립트로 그려지므로 브라우저를 씁니다.
"""

from __future__ import annotations

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


# =============================================================================
#  1. 교보문고
# =============================================================================
def probe_kyobo() -> None:
    from common.browser import PoliteBrowser

    sep("교보문고")

    with PoliteBrowser(wait_for="a[href*='/detail/S']") as b:
        # ---- (1) 온라인 분야 코드 ----
        html = b.get(
            "https://store.kyobobook.co.kr/bestseller/online/weekly/domestic"
        ).text
        tree = HTMLParser(html)

        cats: dict[str, str] = {}
        for a in tree.css("a"):
            href = a.attributes.get("href") or ""
            m = re.search(r"/bestseller/online/weekly/domestic/(\d+)", href)
            if m:
                name = clean(a.text())
                if name and len(name) < 20:
                    cats.setdefault(m.group(1), name)

        print(f"\n[온라인 분야] {len(cats)}개 발견")
        for code, name in sorted(cats.items()):
            print(f"  {code}  {name}")

        # ---- (2) 온라인이 몇 권까지 되는지 ----
        #   지금은 200권(10페이지)으로 잡혀 있는데, 더 되는지 확인합니다.
        print("\n[온라인 최대 권수 확인] 뒤쪽 페이지에 도서가 있는지 봅니다")
        for page in (10, 11, 20, 26):
            try:
                h = b.get(
                    "https://store.kyobobook.co.kr/bestseller/online/weekly/"
                    f"domestic?page={page}"
                ).text
                n = len(set(re.findall(r"/detail/S\d{9,}", h)))
                print(f"  page {page:>3}: 도서 {n}권")
                if n == 0:
                    print(f"    → {page - 1}페이지까지가 끝입니다")
                    break
            except Exception as exc:  # noqa: BLE001
                print(f"  page {page:>3}: 못 읽음 ({type(exc).__name__}) → 여기가 끝")
                break

        # ---- (3) 오프라인 매장 목록 ----
        html = b.get(
            "https://store.kyobobook.co.kr/bestseller/store/seoul/001/00"
        ).text

    tree = HTMLParser(html)
    branches: dict[tuple[str, str], str] = {}
    for a in tree.css("a"):
        href = a.attributes.get("href") or ""
        m = re.search(r"/bestseller/store/([a-z]+)/(\d+)/", href)
        if m:
            branches.setdefault((m.group(1), m.group(2)), clean(a.text()))

    # 화면에 매장 이름이 목록으로 들어 있을 수도 있어 통째로도 찾아봅니다
    raw_pairs = set(re.findall(r"/bestseller/store/([a-z]+)/(\d+)", html))

    print(f"\n[오프라인 매장] 링크에서 {len(branches)}곳, "
          f"본문 전체에서 {len(raw_pairs)}곳 발견")
    if branches:
        for (region, code), name in sorted(branches.items()):
            print(f"  {region}/{code}  {name}")
    elif raw_pairs:
        for region, code in sorted(raw_pairs):
            print(f"  {region}/{code}  (이름 미확인)")
    else:
        print("  ❌ 매장 목록을 못 찾았습니다.")
        print("     매장 선택이 팝업 안에 있어서 처음 화면에는 없을 수 있습니다.")

    # ---- 붙여넣기용 출력 ----
    if cats:
        sep("교보 온라인 분야 — config/sources.yaml 에 붙여넣기")
        for code, name in sorted(cats.items()):
            print(f"""    - code: "{code}"
      name: "{name}"
      unified: ""
      url: "https://store.kyobobook.co.kr/bestseller/online/weekly/domestic/{code}?page={{page}}"
      max_items: 1000
      page_size: 20
      enabled: true""")


# =============================================================================
#  2. 알라딘
# =============================================================================
def probe_aladin(client: PoliteClient) -> None:
    sep("알라딘")

    url = "https://www.aladin.co.kr/shop/common/wbest.aspx?BranchType=1"
    html = client.get(url).text
    tree = HTMLParser(html)

    cats: dict[str, str] = {}
    for a in tree.css("a"):
        href = a.attributes.get("href") or ""
        m = re.search(r"[?&]CID=(\d+)", href)
        if m and "wbest" in href.lower():
            name = clean(a.text())
            if name and len(name) < 20 and m.group(1) != "0":
                cats.setdefault(m.group(1), name)

    print(f"\n[분야] {len(cats)}개 발견")
    for code, name in sorted(cats.items(), key=lambda x: int(x[0])):
        print(f"  {code:>6}  {name}")

    if cats:
        sep("알라딘 분야 — config/sources.yaml 에 붙여넣기")
        for code, name in sorted(cats.items(), key=lambda x: int(x[0])):
            print(f"""    - code: "{code}"
      name: "{name}"
      unified: ""
      url: "https://www.aladin.co.kr/shop/common/wbest.aspx?BranchType=1&CID={code}&page={{page}}"
      max_items: 1000
      page_size: 50
      enabled: true""")


# =============================================================================
#  3. 예스24
# =============================================================================
def probe_yes24(client: PoliteClient) -> None:
    sep("예스24")

    url = "https://www.yes24.com/product/category/bestseller?categoryNumber=001"
    html = client.get(url).text
    tree = HTMLParser(html)

    cats: dict[str, str] = {}
    for a in tree.css("a"):
        href = unquote(a.attributes.get("href") or "")
        m = re.search(r"categoryNumber=(\d{3,})", href)
        if m:
            name = clean(a.text())
            if name and len(name) < 20:
                cats.setdefault(m.group(1), name)

    print(f"\n[분야] {len(cats)}개 발견")
    for code, name in sorted(cats.items()):
        print(f"  {code:>10}  {name}")

    if cats:
        sep("예스24 분야 — config/sources.yaml 에 붙여넣기")
        for code, name in sorted(cats.items()):
            print(f"""    - code: "{code}"
      name: "{name}"
      unified: ""
      url: "https://www.yes24.com/product/category/bestseller?categoryNumber={code}&pageNumber={{page}}&pageSize=120"
      max_items: 1000
      enabled: true""")


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
