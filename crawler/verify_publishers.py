"""
=============================================================================
 확인 — 한 권으로 묶인 책 안에 서로 다른 출판사가 섞여 있지 않은지
=============================================================================

 【왜 만들었나요? — 2026-08-08】
 대표님이 지적하셨습니다.

   "제목, 저자명이 같아도 출판사가 다르면 아예 다른 책으로 분류해야 해.
    지금은 민음사, 서정시학, 다산북스, 문학동네 등 모든 출판사의
    '싯다르타' 가 하나로 뭉쳐있어. 이럼 절대 안 돼."

 규칙(crawler/common/match.py)은 고쳤습니다. 하지만 "고쳤다" 와
 "실제 데이터베이스에서 정말 갈라졌다" 는 다른 이야기입니다.
 이 파일은 진짜 데이터를 읽어서 눈이 아니라 숫자로 확인합니다.

 【중요 — 규칙을 베껴 쓰지 않습니다】
 여기서 similarity() 와 publisher_hard_floor 를 매칭 코드에서 그대로
 가져다 씁니다. 확인용으로 따로 만들면, 나중에 규칙만 바뀌었을 때
 확인 결과가 조용히 거짓말을 하게 됩니다.

 【실행】
 GitHub → Actions → [도서 매칭] 안에서 매칭이 끝난 뒤 자동으로 돕니다.
 따로 돌리려면:  python crawler/verify_publishers.py

 【결과 읽는 법】
   ✅ 0건        → 완전히 해결됐습니다
   ❌ N건        → 아직 섞여 있습니다. 어떤 책인지 목록으로 보여줍니다.
                  (이때 이 파일은 실패로 끝나서 작업이 빨간불이 됩니다)
=============================================================================
"""

from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import config as cfg  # noqa: E402
from common import db  # noqa: E402
from common.match import similarity  # noqa: E402

SHOW = 20  # 화면에 보여줄 최대 건수


def main() -> int:
    mcfg = cfg.load("matching.yaml")
    floor = mcfg["thresholds"].get("publisher_hard_floor", 0.80)

    print("=" * 66)
    print("  확인 — 한 책에 서로 다른 출판사가 섞여 있지 않은지")
    print(f"  기준: 출판사 이름이 {floor:.0%} 미만으로 닮았으면 '다른 출판사'")
    print("=" * 66)

    client = db.connect()
    rows = db.fetch_all_store_books(client)
    print(f"\n서점별 도서 {len(rows):,}권을 읽었습니다.")

    linked = [r for r in rows if r.get("book_id")]
    print(f"그중 도서 마스터에 묶인 것 {len(linked):,}권.")
    if not linked:
        print("\n아직 묶인 책이 없습니다. 먼저 매칭을 실행하세요.")
        return 1

    by_book: dict[int, list[dict]] = defaultdict(list)
    for r in linked:
        by_book[r["book_id"]].append(r)

    conflicts: list[tuple[int, str, list[str], float]] = []
    unknown_mixed = 0

    for book_id, members in by_book.items():
        # 같은 출판사를 여러 서점이 조금씩 다르게 적은 것은 문제가 아닙니다.
        # 정규화한 이름끼리 얼마나 닮았는지로 판단합니다.
        names: list[str] = []
        for m in members:
            p = m.get("norm_publisher")
            if p and p not in names:
                names.append(p)

        if len(names) < 2:
            # 출판사를 아예 모르는 것이 섞여 있는지는 따로 셉니다.
            if any(not m.get("norm_publisher") for m in members) and len(members) > 1:
                unknown_mixed += 1
            continue

        worst = 1.0
        for i in range(len(names)):
            for j in range(i + 1, len(names)):
                worst = min(worst, similarity(names[i], names[j]))

        if worst < floor:
            title = members[0].get("raw_title") or "(제목 없음)"
            raw_names: list[str] = []
            for m in members:
                p = (m.get("raw_publisher") or "").strip()
                if p and p not in raw_names:
                    raw_names.append(p)
            conflicts.append((book_id, title, raw_names, worst))

    print(f"묶인 책 {len(by_book):,}종을 확인했습니다.")
    if unknown_mixed:
        print(f"  · 출판사를 모르는 항목이 함께 묶인 책 {unknown_mixed:,}종 "
              f"(규칙상 더 높은 점수를 요구해서 묶인 것들입니다)")

    print("-" * 66)
    if not conflicts:
        print("✅ 서로 다른 출판사가 한 책으로 묶인 경우: 0건")
        print("   '싯다르타' 처럼 출판사만 다른 책들은 이제 따로 셉니다.")
        return 0

    conflicts.sort(key=lambda c: c[3])
    print(f"❌ 서로 다른 출판사가 한 책으로 묶여 있습니다 — {len(conflicts):,}건")
    print(f"   (가장 안 닮은 순으로 최대 {SHOW}건)\n")
    for book_id, title, names, worst in conflicts[:SHOW]:
        print(f"   • [도서 {book_id}] {title}")
        print(f"       출판사: {' / '.join(names)}   (닮은 정도 {worst:.2f})")
    if len(conflicts) > SHOW:
        print(f"\n   … 외 {len(conflicts) - SHOW:,}건")
    print("\n   → crawler/common/match.py 의 출판사 규칙과 "
          "config/matching.yaml 의 publisher_hard_floor 를 확인하세요.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
