"""
설정 점검 — config/sources.yaml 의 주소가 전부 살아 있는지 확인합니다.

【언제 쓰나요?】
- 분야나 매장을 추가·수정한 뒤
- "어제까지 되던 게 갑자기 안 될 때"

【무엇을 확인하나요?】
설정된 모든 분야·매장의 **첫 페이지만** 열어서 도서가 나오는지 봅니다.
주소에 오타가 있거나 서점이 분야를 없앴으면 여기서 바로 드러납니다.

이걸 안 하면 매일 새벽 수집이 실패하고 나서야 알게 됩니다.

※ 분야당 1건씩만 봅니다. 상세 페이지 진입 없음.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import config as cfg  # noqa: E402
from common import normalize as norm  # noqa: E402
from common.http import PoliteClient  # noqa: E402
from stores import aladin, kyobo, yes24  # noqa: E402

PARSERS = {"aladin": aladin, "yes24": yes24, "kyobo": kyobo}
BROWSER_STORES = {"kyobo"}


def main() -> int:
    only = (sys.argv[1] if len(sys.argv) > 1 else "").strip() or None

    sources = cfg.load("sources.yaml")
    selectors_all = cfg.load("selectors.yaml")
    defaults = sources.get("defaults", {})
    ua = defaults.get("user_agent", "BestsellerTracker/1.0")

    tasks = [t for t in cfg.build_tasks(sources, only_store=only)
             if t.store_code in PARSERS]

    by_store: dict[str, list] = {}
    for t in tasks:
        by_store.setdefault(t.store_code, []).append(t)

    print("=" * 70)
    print(f"  설정 점검 — 분야·매장 {len(tasks)}개의 첫 페이지를 열어봅니다")
    print("=" * 70)

    bad: list[str] = []

    for store_code, store_tasks in by_store.items():
        selectors = selectors_all[store_code]
        print(f"\n▶ {store_code} ({len(store_tasks)}개)")

        if store_code in BROWSER_STORES:
            from common.browser import PoliteBrowser
            fetcher = PoliteBrowser(delay_min=1.5, delay_max=2.5,
                                    wait_for=selectors.get("wait_for"))
        else:
            fetcher = PoliteClient(user_agent=ua, delay_min=1.0, delay_max=1.5,
                                   timeout=25, max_retries=2)

        with fetcher as http:
            for t in store_tasks:
                label = t.label()
                try:
                    resp = http.get(t.url_for(1))
                    rows = PARSERS[store_code].parse_page(
                        resp.text, selectors,
                        role_priority=norm.DEFAULT_ROLE_PRIORITY,
                        page=1, page_size=t.page_size,
                    )
                    if not rows:
                        print(f"  ❌ {label:<34} 도서 0권")
                        bad.append(f"{label} (도서 0권)")
                    else:
                        print(f"  ✅ {label:<34} {len(rows):>3}권  "
                              f"1위: {rows[0].raw_title[:28]}")
                except Exception as exc:  # noqa: BLE001
                    msg = f"{type(exc).__name__}: {exc}"
                    print(f"  ❌ {label:<34} {msg[:70]}")
                    bad.append(f"{label} ({msg[:60]})")

    print("\n" + "=" * 70)
    if bad:
        print(f"  ❌ 문제 {len(bad)}개 — config/sources.yaml 을 고쳐야 합니다:")
        for b in bad:
            print(f"     • {b}")
        print("\n  ※ 서점이 없앤 분야라면 그 항목을 enabled: false 로 바꾸세요.")
        return 1
    print(f"  ✅ 설정된 {len(tasks)}개 전부 정상")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
