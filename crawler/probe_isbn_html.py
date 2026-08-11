"""
=============================================================================
 목록 페이지 어디엔가 ISBN 이 숨어 있는지 — HTML 전체를 뒤집니다
=============================================================================

 【왜 만들었나요? — 2026-08-11 대표님 말씀】
 "어차피 완벽한 전체 대조가 목적이기 때문에 과거에 어떻든 중요하지 않아.
  ISBN만 있다면, 대조하기가 참 쉬운데. 어떻게 방법이 없을까?"

 맞는 말씀입니다. ISBN 이 양쪽에 있으면 제목·저자를 볼 것도 없이 **확정**
 입니다. 지금 손으로 하시는 검토가 통째로 사라집니다.

 【제가 아직 안 해 본 것】
 앞서 확인한 것은 **표지 주소 하나뿐**이었습니다. 목록 페이지 HTML 은
 표지 말고도 수십 가지 값을 담고 있습니다. 링크 주소, data-* 속성,
 페이지 안에 박힌 자바스크립트 변수, 장바구니 담기 버튼의 값 …
 그 안에 ISBN 이 들어 있을 수 있는데 한 번도 안 봤습니다.

 【규칙은 그대로 지킵니다】
   · **매일 이미 받고 있는 그 목록 페이지**를 딱 한 번 더 받습니다.
     새로 뚫는 길이 아닙니다.
   · robots.txt 를 먼저 확인하고, 금지면 그 서점은 건너뜁니다.
   · 상세 페이지에 들어가지 않습니다.
   · 표지 이미지를 저장하지 않습니다.
   · 서점 공식 API 를 쓰지 않습니다.
   · 아무것도 데이터베이스에 저장하지 않습니다. 보기만 합니다.

 【숫자를 아무거나 ISBN 이라고 하지 않습니다】
 검사식(체크섬)이 맞는 것만 셉니다. 잘못된 ISBN 하나면 엉뚱한 두 책이
 영원히 한 권이 됩니다. 빈 값보다 나쁩니다.

 실행: python crawler/probe_isbn_html.py
       GitHub → Actions → [정밀 탐침 (probe)] 에서 함께 돕니다.
=============================================================================
"""

from __future__ import annotations

import re
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import config as cfg  # noqa: E402
from common.http import PoliteClient  # noqa: E402
from common.robots import parse as parse_robots  # noqa: E402
from probe_isbn import scan_html  # noqa: E402

SHOW = 12          # 서점마다 보여줄 예시 수


def origin_of(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def probe_store(store: dict, defaults: dict) -> None:
    name = store.get("name") or store.get("code")
    cats = store.get("categories") or []
    if not cats:
        print(f"\n■ {name}: 분야 설정이 없어 건너뜁니다.")
        return

    url = str(cats[0].get("url", "")).replace("{page}", "1")
    if not url:
        print(f"\n■ {name}: 주소가 없어 건너뜁니다.")
        return

    ua = defaults.get("user_agent", "bestseller-tracker")
    origin = origin_of(url)

    print("\n" + "-" * 66)
    print(f"■ {name}")
    print(f"   {url}")

    # ---- robots.txt 를 먼저 봅니다. 금지면 건너뜁니다 ----
    try:
        with PoliteClient(user_agent=ua, delay_min=1.0, delay_max=1.5) as c:
            r = c.get(f"{origin}/robots.txt", allow_status=(403, 404),
                      check_block_markers=False, min_body_len=1)
        if r.status_code == 200:
            allowed, why = parse_robots(r.text).is_allowed(url, ua)
            if not allowed:
                print(f"   🚫 robots.txt 가 막고 있습니다 — {why}")
                print("      건너뜁니다. 임의로 우회하지 않습니다.")
                return
            print(f"   ✅ robots.txt 확인: {why}")
        else:
            print(f"   ✅ robots.txt 없음(HTTP {r.status_code}) → 제한 없음")
    except Exception as exc:  # noqa: BLE001
        print(f"   ⚠️ robots.txt 확인 실패({exc}) → 안전하게 건너뜁니다.")
        return

    # ---- 목록 페이지 한 장 ----
    try:
        with PoliteClient(
            user_agent=ua,
            delay_min=defaults.get("delay_min_sec", 1.0),
            delay_max=defaults.get("delay_max_sec", 2.0),
            timeout=defaults.get("timeout_sec", 20),
            referer=origin,
        ) as c:
            resp = c.get(url)
        html = resp.text
    except Exception as exc:  # noqa: BLE001
        print(f"   ⚠️ 목록을 받지 못했습니다: {exc}")
        return

    print(f"   받은 글자 수 {len(html):,}자")

    hits = scan_html(html)
    if not hits:
        print("   ❌ 검사식이 맞는 ISBN 이 **하나도** 없습니다.")
        print("      → 이 서점 목록에서는 ISBN 을 얻을 수 없습니다.")
        return

    print(f"   ✅ ISBN 처럼 생긴 값 {len(hits):,}개를 찾았습니다.")
    print(f"      (앞 {SHOW}개. 어디에 들어 있는지 앞뒤 글자를 함께 보여줍니다)\n")
    for got, around in hits[:SHOW]:
        print(f"      {got}")
        print(f"        … {around} …")

    # 어떤 모양으로 들어 있는지 세어 봅니다 (규칙을 만들 때 씁니다)
    kinds = Counter()
    for _, around in hits:
        for pat, label in (
            (r'data-[\w-]*isbn', "data-isbn 속성"),
            (r'isbn', "'isbn' 이라는 말 근처"),
            (r'goodsNo|itemId|ItemId', "상품번호 근처"),
            (r'\.jpg|\.png', "이미지 주소 안"),
        ):
            if re.search(pat, around, re.I):
                kinds[label] += 1
                break
        else:
            kinds["그 밖"] += 1
    print("\n      들어 있는 자리:")
    for k, v in kinds.most_common():
        print(f"        · {k}: {v:,}개")


def main() -> int:
    print("=" * 66)
    print("  목록 페이지에 ISBN 이 숨어 있는지 — HTML 전체 확인")
    print("  ※ 매일 받던 그 페이지를 서점마다 한 장씩만 더 받습니다.")
    print("  ※ 상세 페이지 진입 없음 · 저장 없음 · 공식 API 사용 없음")
    print("=" * 66)

    conf = cfg.load("sources.yaml")
    defaults = conf.get("defaults", {})
    for store in conf.get("stores", []):
        if not store.get("enabled", True):
            continue
        probe_store(store, defaults)

    print("\n" + "=" * 66)
    print("【읽는 법】")
    print("  ❌ 하나도 없음 → 그 서점은 목록으로 ISBN 을 얻을 수 없습니다.")
    print("                   다른 길(예: 국립중앙도서관 서지정보)을 봐야 합니다.")
    print("  ✅ 있음        → 어디에 들어 있는지 보고 뽑는 규칙을 만들면 됩니다.")
    print("                   그 서점 책은 매칭이 **확정**으로 바뀝니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
