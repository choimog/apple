"""
=============================================================================
 자료 정리 — 특정 날짜만 남기고 나머지를 지웁니다
=============================================================================

 【무엇을 하나요? — 2026-08-08 대표님 지시】
 "8월 7일자 자료는 없애주고 8월 8일자 자료를 다시 취합해서 새롭게 시작하자."

 그동안 규칙을 여러 번 고치면서 옛 규칙으로 쌓인 자료가 섞여 있습니다.
 (분야 코드가 바뀌어 생긴 유령 분야, 중복 순위, 잘못 묶인 책 등)
 한 날짜만 남기고 전부 지운 뒤 새로 수집하면 깨끗해집니다.

 ⚠️ 지운 자료는 되돌릴 수 없습니다. 그래서 기본은 '확인만' 입니다.
    실제로 지우려면 --confirm 을 줘야 합니다.

 【두 가지 일을 합니다】
   dates    남길 날짜 하나만 두고 나머지 날짜의 순위·수집기록을 지웁니다
   orphans  아무 순위에도 안 걸린 찌꺼기를 지웁니다
            (수집 뒤에 돌려야 합니다 — 수집이 store_books 를 다시 채우므로)

 【실행】
 GitHub → Actions → [자료 정리] → Run workflow
=============================================================================
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import db  # noqa: E402

CHUNK = 500


def _all_dates(client) -> list[tuple[str, int]]:
    """순위표에 있는 날짜와 건수. (한 번에 1,000행 제한이 있어 나눠 읽습니다)"""
    rows = db._select_all(
        lambda: client.table("rankings").select("snapshot_date").order("id")
    )
    counts: dict[str, int] = {}
    for r in rows:
        d = r["snapshot_date"]
        counts[d] = counts.get(d, 0) + 1
    return sorted(counts.items(), reverse=True)


def _log_dates(client) -> list[tuple[str, int]]:
    rows = db._select_all(
        lambda: client.table("crawl_logs").select("snapshot_date").order("id")
    )
    counts: dict[str, int] = {}
    for r in rows:
        d = r["snapshot_date"]
        counts[d] = counts.get(d, 0) + 1
    return sorted(counts.items(), reverse=True)


# -----------------------------------------------------------------------------
#  1. 날짜 정리
# -----------------------------------------------------------------------------
def clean_dates(client, keep: str, confirm: bool) -> int:
    print("=" * 66)
    print(f"  날짜 정리 — {keep} 만 남깁니다")
    print("=" * 66)

    ranks = _all_dates(client)
    logs = _log_dates(client)

    print("\n▶ 지금 순위표에 있는 날짜")
    if not ranks:
        print("  (없음)")
    for d, n in ranks:
        mark = "✅ 남김" if d == keep else "🗑️  지움"
        print(f"  {mark}  {d}   {n:,}건")

    print("\n▶ 지금 수집기록에 있는 날짜")
    if not logs:
        print("  (없음)")
    for d, n in logs:
        mark = "✅ 남김" if d == keep else "🗑️  지움"
        print(f"  {mark}  {d}   {n:,}건")

    drop_rank = [d for d, _ in ranks if d != keep]
    drop_log = [d for d, _ in logs if d != keep]
    n_rank = sum(n for d, n in ranks if d != keep)
    n_log = sum(n for d, n in logs if d != keep)

    if keep not in dict(ranks):
        print(f"\n⚠️ 남기려는 날짜({keep})에 순위가 하나도 없습니다.")
        print("   날짜를 잘못 적었는지 확인하세요. 아무것도 지우지 않았습니다.")
        return 1

    print(f"\n지울 것: 순위 {n_rank:,}건 ({len(drop_rank)}일) · "
          f"수집기록 {n_log:,}건 ({len(drop_log)}일)")

    if not confirm:
        print("\n[확인만 함] 실제로 지우려면 confirm 을 true 로 두고 다시 실행하세요.")
        return 0

    if not drop_rank and not drop_log:
        print("\n지울 것이 없습니다.")
        return 0

    print("\n▶ 지우는 중...")
    for d in drop_rank:
        client.table("rankings").delete().eq("snapshot_date", d).execute()
        print(f"  · 순위 {d} 지움")
    for d in drop_log:
        client.table("crawl_logs").delete().eq("snapshot_date", d).execute()
        print(f"  · 수집기록 {d} 지움")

    left = _all_dates(client)
    print(f"\n✅ 남은 날짜: {', '.join(d for d, _ in left) or '(없음)'}")
    return 0


# -----------------------------------------------------------------------------
#  2. 찌꺼기 정리
# -----------------------------------------------------------------------------
def clean_orphans(client, confirm: bool) -> int:
    """
    아무 순위에도 안 걸린 찌꺼기를 지웁니다.

    · 순위가 하나도 없는 서점 도서
      (지우면 그 도서의 매칭 근거·부가정보도 함께 지워집니다 — DB 설정)
    · 서점 도서가 하나도 없는 도서 마스터
    · 순위가 하나도 없으면서 꺼져 있는 분야 (분야 코드가 바뀌어 생긴 유령)
    """
    print("=" * 66)
    print("  찌꺼기 정리")
    print("=" * 66)

    used = {
        r["store_book_id"]
        for r in db._select_all(
            lambda: client.table("rankings").select("store_book_id").order("id")
        )
    }
    all_sb = db._select_all(
        lambda: client.table("store_books").select("id,book_id").order("id")
    )
    dead_sb = [r["id"] for r in all_sb if r["id"] not in used]

    live_books = {r["book_id"] for r in all_sb if r["id"] in used and r.get("book_id")}
    all_books = [
        r["id"]
        for r in db._select_all(lambda: client.table("books").select("id").order("id"))
    ]
    dead_books = [b for b in all_books if b not in live_books]

    cats = db._select_all(
        lambda: client.table("categories")
        .select("id,store_id,name,kind,code,enabled")
        .order("id")
    )
    used_cats = {
        r["category_id"]
        for r in db._select_all(
            lambda: client.table("rankings").select("category_id").order("id")
        )
    }
    dead_cats = [c for c in cats if not c["enabled"] and c["id"] not in used_cats]

    print(f"\n  서점 도서 {len(all_sb):,}권 중 순위에 안 걸린 것 {len(dead_sb):,}권")
    print(f"  도서 마스터 {len(all_books):,}종 중 빈 껍데기 {len(dead_books):,}종")
    print(f"  분야 {len(cats)}개 중 꺼져 있고 기록도 없는 것 {len(dead_cats)}개")
    for c in dead_cats[:20]:
        print(f"     · [{c['store_id']}] {c['name']} (kind={c['kind']}, code='{c['code']}')")

    if not confirm:
        print("\n[확인만 함] 실제로 지우려면 confirm 을 true 로 두고 다시 실행하세요.")
        return 0

    print("\n▶ 지우는 중...")
    for i in range(0, len(dead_sb), CHUNK):
        client.table("store_books").delete().in_("id", dead_sb[i:i + CHUNK]).execute()
    print(f"  · 서점 도서 {len(dead_sb):,}권 지움")

    for i in range(0, len(dead_books), CHUNK):
        client.table("books").delete().in_("id", dead_books[i:i + CHUNK]).execute()
    print(f"  · 도서 마스터 {len(dead_books):,}종 지움")

    if dead_cats:
        ids = [c["id"] for c in dead_cats]
        for i in range(0, len(ids), CHUNK):
            client.table("categories").delete().in_("id", ids[i:i + CHUNK]).execute()
        print(f"  · 유령 분야 {len(dead_cats)}개 지움")

    print("\n✅ 정리 완료")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["dates", "orphans"], required=True)
    ap.add_argument("--keep", default="", help="남길 날짜 (YYYY-MM-DD)")
    ap.add_argument("--confirm", action="store_true", help="실제로 지웁니다")
    args = ap.parse_args()

    confirm = args.confirm or os.environ.get("CONFIRM", "").lower() == "true"
    keep = args.keep or os.environ.get("KEEP_DATE", "")

    client = db.connect()

    if args.mode == "dates":
        if not keep:
            print("❌ 남길 날짜(--keep)를 지정하세요.")
            return 1
        return clean_dates(client, keep, confirm)
    return clean_orphans(client, confirm)


if __name__ == "__main__":
    raise SystemExit(main())
