"""
교보문고 — 도서 칸 하나의 HTML 전체를 뜨는 탐침.

선택자(어디서 무엇을 읽을지)를 '추측' 하지 않기 위해,
실제 화면이 그려진 뒤의 도서 칸을 통째로 봅니다.

여기서 본 것을 그대로 config/selectors.yaml 의 kyobo 항목에 적습니다.

※ 목록 페이지 1장만 엽니다. 상세 페이지 진입 없음.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common.browser import PoliteBrowser  # noqa: E402

from selectolax.parser import HTMLParser  # noqa: E402

URL = "https://store.kyobobook.co.kr/bestseller/online/weekly/domestic?page=1"


def sep(t: str) -> None:
    print("\n" + "=" * 70)
    print(f"  {t}")
    print("=" * 70)


def main() -> int:
    with PoliteBrowser(wait_for="a[href*='/detail/S']") as b:
        html = b.get(URL).text
        print(f"✅ 화면이 그려졌습니다. HTML {len(html):,}자")
        print(f"   광고·이미지 요청 차단: {b.blocked_requests}건")
        print(f"   UA: {b.user_agent}")

    tree = HTMLParser(html)

    # ---- 도서 칸 찾기: /detail/S 링크를 품은 가장 바깥 <li> ----
    cards = [
        li for li in tree.css("li")
        if li.css_first("a[href*='/detail/S']") is not None
    ]
    # 중첩된 li 는 제외 (가장 바깥쪽만)
    sep(f"1. 도서 칸 후보 <li> 개수: {len(cards)}개")
    print("   (페이지당 권수와 같으면 정답입니다)")

    if not cards:
        print("   ❌ 도서 칸을 못 찾았습니다.")
        return 1

    card = cards[0]

    sep("2. 첫 번째 도서 칸 — HTML 전체")
    outer = card.html or ""
    # SVG 아이콘은 길기만 하고 쓸모가 없어서 지우고 봅니다
    cleaned = re.sub(r"<svg[\s\S]*?</svg>", "<svg/>", outer)
    print(f"   (원본 {len(outer):,}자 → 아이콘 제거 후 {len(cleaned):,}자)")
    print(cleaned[:12000])

    sep("3. 첫 번째 도서 칸 — 링크 목록")
    for a in card.css("a"):
        href = (a.attributes.get("href") or "")[:90]
        cls = (a.attributes.get("class") or "")[:60]
        txt = " ".join((a.text() or "").split())[:60]
        print(f"   class={cls!r}\n      href={href}\n      text={txt!r}")

    sep("4. 첫 번째 도서 칸 — 이미지")
    for img in card.css("img"):
        print(f"   alt={img.attributes.get('alt')!r}")
        print(f"      src={img.attributes.get('src')}")

    sep("5. 첫 번째 도서 칸 — 순수 텍스트")
    print("   " + " ".join((card.text() or "").split()))

    sep("6. 두 번째 도서 칸 — 순수 텍스트 (순위 표기 확인용)")
    if len(cards) > 1:
        print("   " + " ".join((cards[1].text() or "").split()))

    sep("7. 판매지수 / 순위 / 출간일 흔적 찾기")
    text = card.text() or ""
    for label, pat in {
        "순위 숫자": r"^\s*(\d+)",
        "출간일": r"\d{4}[년.\-/]\s*\d{1,2}",
        "판매지수": r"판매지수|판매량|Sales",
        "별점/리뷰": r"\d+\.\d+|리뷰",
    }.items():
        m = re.search(pat, text)
        print(f"   {label:<10} {'✅ ' + m.group(0)[:30] if m else '❌ 못 찾음'}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
