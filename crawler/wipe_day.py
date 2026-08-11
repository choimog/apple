"""
=============================================================================
 하루치(또는 전체) 순위 자료 지우기
=============================================================================

 【왜 만들었나요? — 2026-08-11 대표님 지시】
 "일단, 11일 데이터는 모두 지우자."

 그날 수집이 여러 번 반쪽으로 돌았고, 거기에 제 실수까지 겹쳐서
 자료를 믿을 수 없게 됐습니다. 어설프게 남겨 두면 순위 그래프와
 AI 리포트가 **틀린 자료로 조용히 계산됩니다.**

 【무엇을 지우나요?】
   · 그 날짜의 순위 기록 (rankings)
   · 그 날짜의 수집 기록 (crawl_logs)
   · 그 날짜의 AI 리포트 (daily_reports)
   · 그래서 순위가 한 줄도 안 남은 상품과, 딸린 책이 없어진 도서 묶음

 ⚠️ 대표님이 손으로 내리신 결정(같은 책 / 다른 책)이 걸린 상품은
    **절대 안 지웁니다.** 상품을 지우면 데이터베이스가 그 결정까지
    함께 지우기 때문입니다(ON DELETE CASCADE).

 【되돌릴 수 있나요?】
   ❌ 없습니다. 지운 날짜는 다시 수집해야 채워집니다.
      (그 날짜를 다시 수집하면 서점이 지금 보여주는 순위로 채워집니다.
       '어제의 어제' 를 되살릴 수는 없습니다)

 실행: GitHub → Actions → [하루치 자료 지우기] → Run workflow
       date  : 2026-08-11 처럼 적습니다. all 이라고 적으면 전부입니다.
       dry_run : true 면 아무것도 안 지우고 얼마나 지울지만 알려 줍니다.
=============================================================================
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import db  # noqa: E402

BATCH = 300


def main() -> int:
    target = (os.environ.get("WIPE_DATE") or "").strip()
    dry = os.environ.get("DRY_RUN", "").lower() == "true"

    if not target:
        print("❌ 지울 날짜를 안 알려 주셨습니다. (예: 2026-08-11 또는 all)")
        return 1
    all_days = target.lower() == "all"
    if not all_days and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", target):
        print(f"❌ 날짜 모양이 이상합니다: {target}")
        print("   2026-08-11 처럼 적어 주세요. 전부 지우려면 all 이라고 적습니다.")
        return 1

    print("=" * 66)
    print(f"  {'전체 순위 자료' if all_days else target} 지우기")
    if dry:
        print("  🔍 확인만 합니다. 아무것도 지우지 않습니다.")
    print("=" * 66)

    client = db.connect()

    before = (client.table("book_matches").select("id", count="exact")
              .in_("decision", ["manual_merge", "manual_split"])
              .limit(1).execute().count or 0)
    print(f"\n🔒 대표님이 내리신 결정 {before:,}건 — 끝나고 다시 셉니다.\n")

    # ---- 지울 날짜를 정합니다 ----
    #  ⚠️ all 이어도 '조건 없는 지우기' 는 쓰지 않습니다.
    #     날짜 하나씩 끊어서 지웁니다. 이유가 둘입니다.
    #       · 60만 줄을 한 문장으로 지우면 도중에 끊길 수 있습니다
    #       · 어디까지 했는지 화면에 남아, 끊겨도 이어서 할 수 있습니다
    def oldest_day(table: str) -> str | None:
        """
        그 표에 남아 있는 가장 이른 날짜. 없으면 None.

        ⚠️ '지울 날짜 목록' 을 미리 만들어 두지 않습니다.
           목록을 미리 만들면 거기서 빠진 날짜가 영영 안 지워집니다.
           표에 아직 남아 있는지를 **매번 다시 물어봅니다.**
           그러면 어느 표에 어떤 날짜가 있든 하나도 안 남습니다.
        """
        rows = (client.table(table).select("snapshot_date")
                .order("snapshot_date").limit(1).execute().data or [])
        return str(rows[0]["snapshot_date"]) if rows else None

    # ---- ① 순위·기록·리포트 ----
    print("-" * 66)
    print("① 순위·수집기록·리포트를 날짜별로 지웁니다")
    for table, label in (("rankings", "순위"),
                         ("crawl_logs", "수집 기록"),
                         ("daily_reports", "AI 리포트")):
        if not all_days:
            n = (client.table(table).select("snapshot_date", count="exact")
                 .eq("snapshot_date", target).limit(1).execute().count or 0)
            print(f"   {label} {n:,}줄", end="")
            if n and not dry:
                client.table(table).delete().eq("snapshot_date", target).execute()
                print("  ✅")
            else:
                print("  (확인만)" if dry else "  — 없음")
            continue

        # 전부 지우기: 남은 날짜가 없어질 때까지 하나씩
        done = 0
        while True:
            day = oldest_day(table)
            if day is None:
                break
            n = (client.table(table).select("snapshot_date", count="exact")
                 .eq("snapshot_date", day).limit(1).execute().count or 0)
            print(f"   {label} {day} — {n:,}줄", end="")
            if dry:
                print("  (확인만)")
                break          # 확인만 할 때는 첫 날짜만 보여 주고 멈춥니다
            client.table(table).delete().eq("snapshot_date", day).execute()
            print("  ✅")
            done += 1
            if done > 400:     # 무한히 도는 것을 막는 안전장치
                print(f"   ⚠️ {label}: 400일을 넘겨 멈춥니다. 다시 실행해 주세요.")
                break

    # ---- ② 순위가 한 줄도 안 남은 상품 ----
    print("-" * 66)
    print("② 순위가 한 줄도 안 남은 상품을 지웁니다")
    print("   ⚠️ 대표님 결정이 걸린 상품은 순위가 없어도 남깁니다.")

    ids = [r["id"] for r in db._select_all(
        lambda: client.table("store_books").select("id").order("id"))]
    print(f"   상품 {len(ids):,}개를 {BATCH}개씩 나눠 봅니다.")

    gone = kept = 0
    for start in range(0, len(ids), BATCH):
        chunk = ids[start:start + BATCH]

        # ⚠️ Supabase 는 한 번에 1,000줄까지만 줍니다. 나눠서 전부 읽지
        #    않으면 순위가 **있는** 책이 없는 것처럼 보여서 지워집니다.
        #    2026-08-11 에 실제로 그렇게 자료를 잃었습니다.
        alive = {r["store_book_id"] for r in db._select_all(
            lambda: client.table("rankings").select("store_book_id")
            .in_("store_book_id", chunk).order("store_book_id"))}

        cand = [i for i in chunk if i not in alive]
        if not cand:
            continue

        locked: set[int] = set()
        for col in ("store_book_a", "store_book_b"):
            got = db._select_all(
                lambda c=col: client.table("book_matches").select(c)
                .in_(c, cand)
                .in_("decision", ["manual_merge", "manual_split"])
                .order("id"))
            locked.update(r[col] for r in got)

        drop = [i for i in cand if i not in locked]
        kept += len(locked)
        if not drop:
            continue
        gone += len(drop)
        if not dry:
            client.table("store_books").delete().in_("id", drop).execute()

    print(f"   → 상품 {gone:,}개" + (" (지우지 않았습니다)" if dry else " 지웠습니다"))
    print(f"   → 결정 때문에 남긴 상품 {kept:,}개")

    # ---- ③ 딸린 책이 없어진 도서 묶음 ----
    print("-" * 66)
    print("③ 딸린 책이 없어진 도서 묶음을 지웁니다")
    if dry:
        print("   (확인만 — 건너뜁니다)")
    else:
        used = {r["book_id"] for r in db._select_all(
            lambda: client.table("store_books").select("book_id")
            .not_.is_("book_id", "null").order("id")) if r.get("book_id")}
        print(f"   → {db.delete_orphan_books(client, used):,}개 지웠습니다")

    after = (client.table("book_matches").select("id", count="exact")
             .in_("decision", ["manual_merge", "manual_split"])
             .limit(1).execute().count or 0)
    print("=" * 66)
    if after != before:
        print(f"🚨 대표님 결정이 {before:,} → {after:,} 로 줄었습니다! 알려 주세요.")
        return 1
    print(f"🔒 대표님이 내리신 결정 {after:,}건 — 그대로입니다. ✅")
    print("\n이제 [매일 수집] 을 돌리시면 그 날짜가 새로 채워집니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
