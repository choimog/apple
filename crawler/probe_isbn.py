"""
=============================================================================
 표지 주소에서 ISBN 을 얻을 수 있는지 — 이미 모아 둔 자료로 확인합니다
=============================================================================

 【왜 만들었나요? — 2026-08-11 대표님 질문】
 "교보는 ISBN을 딸 수 있는데, 알라딘과 예스는 목차에서 ISBN을 절대 딸 수
  없는게 맞지? 어떤 방법도 없는 게 맞나?"

 코드에는 "알라딘 목록에는 ISBN13 이 없습니다" 라고 적혀 있습니다.
 그런데 그건 **제가 그렇게 적어 둔 것**이지 확인한 것이 아닙니다.
 '절대 없다' 는 확인 없이 말할 수 있는 문장이 아닙니다.

 교보에서 ISBN 을 얻는 방법이 바로 **표지 주소**였습니다.

     https://contents.kyobobook.co.kr/sih/fit-in/300x0/pdt/9791199489561.jpg
                                                          └── ISBN13 ──┘

 같은 방법이 다른 서점에도 통할 수 있습니다. 알라딘은 예전에 표지 파일
 이름을 ISBN-10 으로 쓰던 시절이 있었습니다.

 【어떻게 확인하나요?】
 새로 수집하지 않습니다. **이미 저장해 둔 표지 주소 13만 건**을 훑습니다.
 서점에 요청을 한 건도 보내지 않고, 돈도 들지 않습니다.

 【숫자만 보면 안 됩니다】
 주소 안의 숫자를 아무거나 ISBN 이라고 세면 안 됩니다.
 예스24 표지 주소의 192474512 는 상품번호이지 ISBN 이 아닙니다.
 그래서 **ISBN 검사식(체크섬)까지 맞아야** 셉니다. 우연히 맞을 확률은
 10분의 1이고, 그마저도 자릿수가 맞아야 합니다.

 실행: python crawler/probe_isbn.py
       (GitHub → Actions → [정밀 탐침 (probe)] 에서도 함께 돕니다)
=============================================================================
"""

from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

STORE_NAME = {1: "교보문고", 2: "예스24", 3: "알라딘"}

SHOW = 5   # 서점마다 보여줄 예시 수


def isbn13_ok(s: str) -> bool:
    """ISBN13 검사식. 앞 12자리로 마지막 한 자리가 정해집니다."""
    if len(s) != 13 or not s.isdigit():
        return False
    total = sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(s[:12]))
    return (10 - total % 10) % 10 == int(s[12])


def isbn10_ok(s: str) -> bool:
    """ISBN10 검사식. 마지막 자리는 X 일 수 있습니다."""
    if len(s) != 10:
        return False
    if not s[:9].isdigit():
        return False
    last = s[9]
    if last not in "0123456789Xx":
        return False
    total = sum(int(c) * (10 - i) for i, c in enumerate(s[:9]))
    total += 10 if last in "Xx" else int(last)
    return total % 11 == 0


def to_isbn13(isbn10: str) -> str:
    """ISBN10 → ISBN13 (앞에 978 을 붙이고 검사식을 다시 계산)"""
    core = "978" + isbn10[:9]
    total = sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(core))
    return core + str((10 - total % 10) % 10)


def find_isbn(url: str) -> tuple[str, str] | None:
    """
    표지 주소에서 ISBN 을 찾습니다.
    돌려주는 값: (ISBN13, 어디서 찾았는지) 또는 None

    ⚠️ 검사식이 맞는 것만 돌려줍니다. 상품번호를 ISBN 이라고 하면
       엉뚱한 책끼리 '같은 책' 으로 확정돼 버립니다. 빈 값보다 나쁩니다.
    """
    # 13자리 (교보 방식)
    for m in re.finditer(r"\d{13}", url):
        if isbn13_ok(m.group()):
            return m.group(), "13자리"
    # 10자리 (알라딘 옛 방식일 가능성)
    for m in re.finditer(r"(?<!\d)(\d{9}[\dXx])(?!\d)", url):
        if isbn10_ok(m.group(1)):
            return to_isbn13(m.group(1)), "10자리→13자리"
    return None


# HTML 안에서 찾은 자리 앞뒤로 보여줄 글자 수
CONTEXT = 70


def scan_html(html: str) -> list[tuple[str, str]]:
    """
    HTML **전체**에서 ISBN 처럼 생긴 것을 찾습니다.
    돌려주는 값: [(ISBN13, 그 자리 앞뒤 글자)]

    【왜 표지 주소만 보면 안 되나요? — 2026-08-11】
    목록 페이지는 표지 말고도 수십 가지 값을 담고 있습니다.
    링크 주소, data-* 속성, 페이지에 박힌 자바스크립트 변수 …
    그 안에 ISBN 이 있을 수 있는데 한 번도 안 봤습니다.

    ⚠️ 검사식이 맞는 것만 담습니다. 상품번호를 ISBN 이라고 하면
       엉뚱한 두 책이 영원히 한 권이 됩니다.
    """
    hits: list[tuple[str, str]] = []
    seen: set[str] = set()

    # 앞뒤에 숫자나 붙임표가 더 붙어 있으면 다른 번호의 일부입니다
    for m in re.finditer(r"(?<![\d-])(\d{13}|\d{9}[\dXx])(?![\d-])", html):
        raw = m.group(1)
        if len(raw) == 13:
            if not isbn13_ok(raw):
                continue
            got = raw
        else:
            if not isbn10_ok(raw):
                continue
            got = to_isbn13(raw)

        lo = max(0, m.start() - CONTEXT)
        hi = min(len(html), m.end() + CONTEXT)
        around = re.sub(r"\s+", " ", html[lo:hi]).strip()
        key = f"{got}|{around[:40]}"
        if key in seen:
            continue
        seen.add(key)
        hits.append((got, around))
    return hits


def main() -> int:
    from common import db  # 여기서 불러야 시험이 DB 없이 돕니다

    print("=" * 66)
    print("  표지 주소에서 ISBN 을 얻을 수 있나 — 저장된 자료로 확인")
    print("  ※ 서점에 요청을 보내지 않습니다. 수집도, 돈도 없습니다.")
    print("=" * 66)

    client = db.connect()
    rows = db.fetch_all_store_books(client)
    print(f"\n서점별 도서 {len(rows):,}권을 읽었습니다.\n")

    total: dict[int, int] = defaultdict(int)
    have_url: dict[int, int] = defaultdict(int)
    found: dict[int, int] = defaultdict(int)
    already: dict[int, int] = defaultdict(int)
    how: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    samples: dict[int, list[str]] = defaultdict(list)
    misses: dict[int, list[str]] = defaultdict(list)

    for r in rows:
        sid = r.get("store_id") or 0
        total[sid] += 1
        if r.get("isbn13"):
            already[sid] += 1
        url = (r.get("cover_url") or "").strip()
        if not url:
            continue
        have_url[sid] += 1
        hit = find_isbn(url)
        if hit:
            found[sid] += 1
            how[sid][hit[1]] += 1
            if len(samples[sid]) < SHOW:
                samples[sid].append(f"{hit[0]}  ←  {url}")
        elif len(misses[sid]) < SHOW:
            misses[sid].append(url)

    for sid in sorted(total):
        name = STORE_NAME.get(sid, f"서점{sid}")
        n, u, f = total[sid], have_url[sid], found[sid]
        pct = (100.0 * f / u) if u else 0.0
        print("-" * 66)
        print(f"■ {name}")
        print(f"   전체 {n:,}권 · 표지 주소 있는 것 {u:,}권")
        print(f"   지금 ISBN 이 채워져 있는 것 {already[sid]:,}권")
        print(f"   표지 주소에서 ISBN 을 찾아낸 것 **{f:,}권 ({pct:.1f}%)**")
        if how[sid]:
            for k, v in sorted(how[sid].items(), key=lambda x: -x[1]):
                print(f"      · {k}: {v:,}건")
        if samples[sid]:
            print("   찾은 예시:")
            for s in samples[sid]:
                print(f"      {s}")
        if misses[sid]:
            print("   못 찾은 예시:")
            for s in misses[sid]:
                print(f"      {s}")

    print("-" * 66)
    print("\n【읽는 법】")
    print("  · 0.0% 면 그 서점은 표지 주소로 ISBN 을 얻을 수 없습니다.")
    print("    '못 찾은 예시' 를 보시면 무엇이 들어 있는지 알 수 있습니다.")
    print("  · 몇 % 라도 나오면 그만큼은 공짜로 얻을 수 있다는 뜻입니다.")
    print("    ISBN 이 양쪽에 있으면 같은 책 여부를 **확정**할 수 있습니다.")
    print("\n※ 이 프로그램은 아무것도 저장하지 않습니다. 세어 보기만 합니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
