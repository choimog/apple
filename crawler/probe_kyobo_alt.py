"""
교보문고 — robots.txt 상 '허용된' 다른 입구가 있는지 찾는 탐침.

【왜 필요한가요?】
교보 베스트셀러 화면은 데이터를 /api/gw 에서 받아오는데,
그 경로는 교보 robots.txt 가 금지하고 있습니다.

포기하기 전에, 같은 정보를 얻을 수 있는 '허용된' 입구가 있는지 확인합니다.
  - 옛 사이트(www.kyobobook.co.kr) 가 아직 살아 있는가
  - 모바일 웹이 따로 있는가
  - 각 주소의 robots.txt 는 뭐라고 되어 있는가
  - 받아온 HTML 에 도서 데이터가 실제로 들어 있는가

※ 모든 요청 전에 robots.txt 를 먼저 확인하고, 금지면 요청하지 않습니다.
※ 상세 페이지 진입 없음.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common.http import PoliteClient  # noqa: E402
from common.robots import parse as parse_robots  # noqa: E402

UA = "BestsellerTracker/1.0 (+https://github.com/choimog/apple)"

# 확인해 볼 후보 주소들
CANDIDATES = [
    "https://store.kyobobook.co.kr/bestseller/online/weekly/domestic?page=1",
    "https://www.kyobobook.co.kr/bestseller/online/weekly/domestic",
    "https://www.kyobobook.co.kr/",
    "https://mobile.kyobobook.co.kr/bestseller/online/weekly/domestic",
    "https://product.kyobobook.co.kr/bestseller/online/weekly/domestic",
]

# 목록 페이지에 도서가 실려 있다면 나타날 표시
DATA_SIGNS = {
    "상품 링크(/detail/S...)": r"/detail/S\d{9,}",
    "표지 이미지(ISBN 포함)": r"contents\.kyobobook\.co\.kr/sih/[^\"']*?/pdt/97\d{11}",
    "판매지수/판매량 글자": r"판매지수|판매량",
    "로딩 뼈대(데이터 없음 신호)": r"animate-shimmer",
}


def sep(t: str) -> None:
    print("\n" + "=" * 70)
    print(f"  {t}")
    print("=" * 70)


def show_robots(origin: str, client: PoliteClient) -> "object | None":
    """그 사이트의 robots.txt 를 통째로 보여주고 규칙을 돌려줍니다."""
    try:
        r = client.get(f"{origin}/robots.txt", allow_status=(403, 404),
                       check_block_markers=False, min_body_len=1)
    except Exception as exc:  # noqa: BLE001
        print(f"  robots.txt 읽기 실패: {type(exc).__name__}: {exc}")
        return None

    if r.status_code != 200:
        print(f"  robots.txt 없음 (HTTP {r.status_code}) → 제한 없음")
        return None

    body = r.text.strip()
    print(f"  robots.txt 전문 ({len(body)}자):")
    for line in body.splitlines():
        print(f"    | {line}")
    return parse_robots(body)


def main() -> int:
    origins = sorted({f"{urlsplit(u).scheme}://{urlsplit(u).netloc}" for u in CANDIDATES})

    with PoliteClient(user_agent=UA, delay_min=1.5, delay_max=2.5,
                      timeout=25, max_retries=2) as client:

        # ---- 1. 후보 사이트들의 robots.txt 전문 ----
        rules_by_origin: dict[str, object] = {}
        for origin in origins:
            sep(f"robots.txt — {origin}")
            rules = show_robots(origin, client)
            if rules is not None:
                rules_by_origin[origin] = rules

        # ---- 2. 후보 주소별로 실제로 받아보기 ----
        for url in CANDIDATES:
            sep(f"확인 — {url}")
            origin = f"{urlsplit(url).scheme}://{urlsplit(url).netloc}"

            rules = rules_by_origin.get(origin)
            if rules is not None:
                allowed, why = rules.is_allowed(url, UA)
                print(f"  robots 판정: {'✅ 허용' if allowed else '🚫 금지'} — {why}")
                if not allowed:
                    print("  → 금지이므로 요청하지 않습니다.")
                    continue
            else:
                print("  robots 판정: 규칙 없음 → 허용으로 봅니다")

            try:
                resp = client.get(url, allow_status=(301, 302, 303, 307, 308, 404, 410))
            except Exception as exc:  # noqa: BLE001
                print(f"  ❌ 요청 실패: {type(exc).__name__}: {exc}")
                continue

            final = str(resp.url)
            print(f"  HTTP {resp.status_code}, 본문 {len(resp.text):,}자")
            if final != url:
                print(f"  ↪ 최종 도착 주소: {final}")
                if "store.kyobobook.co.kr" in final and "store." not in url:
                    print("     (= 새 사이트로 넘어감. 옛 주소는 더 이상 별도 화면이 아님)")

            html = resp.text
            for label, pattern in DATA_SIGNS.items():
                n = len(set(re.findall(pattern, html)))
                mark = "✅" if n else "❌"
                print(f"    {mark} {label}: {n}개")

    # ---- 3. 결론 ----
    sep("결론")
    print("  위 결과에서 '상품 링크'와 '표지 이미지'가 함께 나온 주소가 있으면")
    print("  브라우저 없이, 금지 경로 없이 교보를 수집할 수 있습니다.")
    print("  둘 다 0개라면 허용된 정적 입구는 존재하지 않는 것입니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
