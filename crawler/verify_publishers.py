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
# 🚨 【2026-08-12 — 매칭과 똑같은 잣대를 써야 합니다】
# 매칭은 '윌북(willbook)' 과 '윌북' 을 같은 출판사로 보도록 고쳤는데,
# 이 검사기는 옛 잣대(similarity)를 그대로 쓰고 있었습니다.
# 그래서 **제대로 묶인 359종을 잘못됐다고 신고**하고 작업을 멈췄습니다.
# 매칭이 쓰는 함수를 그대로 가져다 씁니다. 잣대가 갈리면 안 됩니다.
#
# publisher_sides = '이름 여러 개를 같은 출판사끼리 편으로 나누기'.
# 매칭에서 갈라낼 때(run_match.split_by_publisher)와 **같은 함수**입니다.
from common.match import publisher_sides, set_publisher_aliases  # noqa: E402
from common.match import publisher_similarity as similarity  # noqa: E402

SHOW = 20  # 화면에 보여줄 최대 건수


def joined_by_person(
    members: list[dict],
    names: list[str],
    floor: float,
    merge_adj: dict[int, set[int]],
) -> bool:
    """
    이 책에 출판사가 섞인 것이 **사람 결정 때문인지** 봅니다.

    출판사 이름을 닮은 것끼리 묶은 뒤(표기만 다른 같은 출판사는 한 편),
    사람이 '같은 책' 이라고 한 짝을 따라가며 그 편들을 이어 봅니다.
    전부 하나로 이어지면 사람이 일부러 그렇게 하신 것입니다.

    ⚠️ 일부만 이어지면 통과시키지 않습니다. 사람이 정한 것 말고도
       기계가 잘못 이어 붙인 부분이 남아 있다는 뜻이니까요.
    """
    # ---- 출판사 이름을 닮은 것끼리 편으로 나눕니다 ----
    #      (매칭이 갈라낼 때 쓰는 것과 같은 함수)
    sides = publisher_sides(names, floor)
    side_of: dict[str, int] = {}
    for k, idxs in enumerate(sides):
        for x in idxs:
            side_of[names[x]] = k

    if len(sides) < 2:
        return False   # 표기만 다른 같은 출판사 (여기 올 일은 없습니다)

    # ---- 사람이 이은 짝으로 편끼리 합쳐 봅니다 ----
    parent = list(range(len(sides)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    ids = {m["id"] for m in members}
    side_of_id: dict[int, int] = {}
    for m in members:
        p = m.get("norm_publisher")
        if p in side_of:
            side_of_id[m["id"]] = side_of[p]

    for i in ids:
        for j in merge_adj.get(i, ()):
            if j not in ids:
                continue
            si, sj = side_of_id.get(i), side_of_id.get(j)
            if si is None or sj is None:
                continue
            ri, rj = find(si), find(sj)
            if ri != rj:
                parent[rj] = ri

    return len({find(k) for k in range(len(sides))}) == 1


def main() -> int:
    mcfg = cfg.load("matching.yaml")
    floor = mcfg["thresholds"].get("publisher_hard_floor", 0.80)

    print("=" * 66)
    print("  확인 — 한 책에 서로 다른 출판사가 섞여 있지 않은지")
    print(f"  기준: 출판사 이름이 {floor:.0%} 미만으로 닮았으면 '다른 출판사'")
    print("=" * 66)

    client = db.connect()

    # 🚨 【2026-08-12 — 매칭과 똑같은 표를 써야 합니다】
    #    대표님이 [출판사 묶기] 로 '한빛life = 한빛라이프' 라고 정하셨는데
    #    이 검사기가 그 표를 안 읽으면, 제대로 묶인 책을 '출판사가 섞였다'
    #    고 신고하면서 [도서 매칭] 을 통째로 멈춥니다.
    #    (오늘 이미 같은 종류의 사고를 두 번 겪었습니다)
    alias = db.fetch_publisher_aliases(client)
    set_publisher_aliases(alias)
    if alias:
        print(f"\n대표님이 '같은 출판사' 로 정하신 이름 {len(alias)}개 "
              f"({len(set(alias.values()))}무리)를 함께 봅니다.")

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

    # ---- 사람이 '같은 책' 이라고 한 짝 ----
    #
    # 【2026-08-11 — 왜 이걸 봐야 하나요?】
    # 이 검사는 "한 책에 다른 출판사가 섞이면 잘못" 이라는 규칙입니다.
    # 그런데 대표님이 직접 '같은 책' 이라고 정하신 경우가 있습니다.
    #
    #     알라딘·교보  필름(Feelm)
    #     예스24       필름
    #     YBM / 와이비엠 / YBM(와이비엠)
    #     PAGODA Books / 파고다북스
    #
    # 글자로만 보면 안 닮았지만(한글·영문이라 0%), 실제로는 같은 출판사
    # 입니다. 기계는 알 수 없고 사람은 압니다.
    #
    # 이걸 '잘못' 으로 세면, 대표님이 옳게 판단하실수록 검사가 빨간불이
    # 됩니다. 그러면 진짜 고장이 그 속에 묻힙니다.
    # 그래서 **사람 결정으로 이어진 것은 따로 세고 통과**시킵니다.
    # 다만 숫자는 반드시 보여 드립니다 (감추지 않습니다).
    manual = db.fetch_manual_decisions(client)
    merge_adj: dict[int, set[int]] = defaultdict(set)
    for (a, b), d in manual.items():
        if d == "manual_merge":
            merge_adj[a].add(b)
            merge_adj[b].add(a)

    conflicts: list[tuple[int, str, list[str], float]] = []
    unknown_mixed = 0
    by_decision = 0            # 사람이 정해서 섞인 것

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

        # 🚨 【2026-08-12 — '두 개씩 전부' 로 재면 안 됩니다】
        #
        #   교보 YBM(와이비엠) / 예스24 YBM / 알라딘 와이비엠
        #
        # 'YBM' 과 '와이비엠' 만 떼어 놓고 재면 0.00 입니다(한글·영문).
        # 그래서 두 개씩 전부 재던 예전 방식은 이 책을 '잘못 묶였다' 고
        # 신고했습니다. 하지만 가운데 'YBM(와이비엠)' 이 두 이름이 같은
        # 곳이라고 **서점이 직접 적어 준 증거**입니다.
        #
        # 매칭이 갈라낼 때 쓰는 것과 똑같이, 이어지면 한 편으로 셉니다.
        # 이어 줄 이름이 없는 민음사 / 문학동네 는 여전히 두 편입니다.
        sides = publisher_sides(names, floor)

        if len(sides) > 1:
            # 왜 갈렸는지 보여 주려고, 서로 다른 편끼리 가장 안 닮은 값을 찾습니다.
            worst = 1.0
            for i in range(len(names)):
                for j in range(i + 1, len(names)):
                    if any(i in s and j in s for s in sides):
                        continue           # 같은 편끼리는 셈에서 뺍니다
                    worst = min(worst, similarity(names[i], names[j]))

            # 🚨 사람이 이어 놓은 것인지 먼저 봅니다.
            if joined_by_person(members, names, floor, merge_adj):
                by_decision += 1
                continue

            title = members[0].get("raw_title") or "(제목 없음)"
            raw_names: list[str] = []
            for m in members:
                p = (m.get("raw_publisher") or "").strip()
                if p and p not in raw_names:
                    raw_names.append(p)
            conflicts.append((book_id, title, raw_names, worst))

    print(f"묶인 책 {len(by_book):,}종을 확인했습니다.")
    if by_decision:
        print(f"  · 대표님이 '같은 책' 이라고 정하셔서 출판사가 섞인 책 "
              f"{by_decision:,}종 → 통과시킵니다")
        print(f"    (사람 결정이 기계 규칙보다 우선입니다. 되돌리시려면 "
              f"검토 화면에서 '되돌리기')")
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
