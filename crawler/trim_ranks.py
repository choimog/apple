"""
=============================================================================
 기준 밖 순위 정리 — 일간 300위 · 주간 500위
=============================================================================

 【왜 이 프로그램인가요? — 2026-08-11】
 같은 일을 하는 SQL(db/space-trim.sql)을 먼저 드렸는데,
 Supabase 화면에서 이렇게 나왔습니다.

     Failed to fetch (api.supabase.com)

 SQL 이 틀린 게 아니라 **브라우저가 기다리다 지쳐서 끊긴 것**입니다.
 36만 줄을 한 번에 지우려니 화면의 제한 시간(약 2분)을 넘겼습니다.
 브라우저로 할 일이 아닙니다.

 그래서 GitHub 에서 돌리도록 옮겼습니다.
   · 시간 제한이 넉넉합니다 (최대 몇 시간)
   · 분야 하나씩 나눠서 지우므로 한 번에 무리하지 않습니다
   · 어디까지 했는지 화면에 계속 나옵니다
   · 중간에 끊겨도 다시 누르면 이어서 합니다 (지운 것은 이미 지워짐)

 【무엇을 지우나요?】
   ① 분야마다 정해진 순위(max_items)를 넘는 순위 기록
      config/sources.yaml 에서 일간 300 · 주간 500 으로 정해 두었습니다.
   ② 그래서 순위가 한 줄도 안 남은 상품 정보
   ③ 그래서 딸린 책이 하나도 없어진 도서 묶음

 ⚠️⚠️ 대표님이 손으로 내리신 결정(같은 책 / 다른 책)이 걸린 상품은
       **절대 안 지웁니다.** 지금 8만 5천 건이 있습니다.
       상품을 지우면 데이터베이스가 그 결정까지 함께 지웁니다
       (ON DELETE CASCADE). 그래서 ② 에서 그런 상품은 남깁니다.

 【되돌릴 수 있나요?】
   ❌ 없습니다. 다만 14일이 지난 자료는 이미 보관소(GitHub)에 있고
      그 파일에는 1,000위까지 그대로 들어 있습니다.

 실행: GitHub → Actions → [기준 밖 순위 정리] → Run workflow
       확인만 하려면 dry_run 을 true 로 두세요 (아무것도 안 지웁니다).
=============================================================================
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import config as cfg  # noqa: E402
from common import db  # noqa: E402

# sources.yaml 에서 분야를 못 찾았을 때 쓰는 기본값
FALLBACK = {"weekly": 500}
FALLBACK_DEFAULT = 300

# 한 번에 확인할 상품 수. 너무 크면 주소가 길어져 요청이 실패합니다.
BATCH = 300


def caps_from_config() -> dict[tuple[str, str, str], int]:
    """
    sources.yaml 에서 (서점코드, 종류, 분야코드) → 최대 순위 를 읽습니다.

    ⚠️ 데이터베이스의 categories.max_items 를 그대로 믿지 않습니다.
       그 값은 수집이 돌 때 맞춰지는데, 아직 안 돌았으면 옛 값(1000)이
       남아 있습니다. 그걸 믿으면 **아무것도 안 지우고 성공했다고**
       말하게 됩니다.
    """
    conf = cfg.load("sources.yaml")
    out: dict[tuple[str, str, str], int] = {}
    for key, block in conf.items():
        if key == "defaults" or not isinstance(block, dict):
            continue
        store = str(block.get("store") or "")
        kind = str(block.get("kind") or "online")
        for cat in block.get("categories") or []:
            code = str(cat.get("code", ""))
            out[(store, kind, code)] = int(cat.get("max_items", 200))
    return out


def cap_for(cat: dict, caps: dict, store_code: dict[int, str]) -> int:
    """이 분야에서 몇 위까지 남길지."""
    key = (store_code.get(cat.get("store_id"), ""),
           str(cat.get("kind") or "online"),
           str(cat.get("code") or ""))
    if key in caps:
        return caps[key]
    return FALLBACK.get(str(cat.get("kind") or ""), FALLBACK_DEFAULT)


def main() -> int:
    dry = os.environ.get("DRY_RUN", "").lower() == "true"

    print("=" * 66)
    print("  기준 밖 순위 정리 — 일간 300위 · 주간 500위")
    if dry:
        print("  🔍 확인만 합니다. 아무것도 지우지 않습니다.")
    print("=" * 66)

    client = db.connect()
    caps = caps_from_config()
    print(f"\n설정에서 분야 {len(caps):,}개의 기준을 읽었습니다.")

    stores = client.table("stores").select("id,code").execute().data or []
    store_code = {s["id"]: s["code"] for s in stores}

    cats = (client.table("categories")
            .select("id,store_id,kind,code,name,max_items")
            .order("id").execute().data or [])
    print(f"데이터베이스에 분야 {len(cats):,}개가 있습니다.\n")

    # ---- 지우기 전에 대표님 결정이 몇 건인지 세어 둡니다 ----
    #      끝나고 이 숫자가 그대로인지 확인합니다. 줄었으면 큰일입니다.
    before = (client.table("book_matches")
              .select("id", count="exact")
              .in_("decision", ["manual_merge", "manual_split"])
              .limit(1).execute().count or 0)
    print(f"🔒 대표님이 내리신 결정 {before:,}건 — 끝나고 다시 셉니다.\n")

    # -------------------------------------------------------------------
    #  ① 기준을 넘는 순위 기록 — 분야 하나씩
    # -------------------------------------------------------------------
    print("-" * 66)
    print("① 기준을 넘는 순위 기록을 지웁니다 (분야 하나씩)")
    total = 0
    # ② 에서 '① 이 지웠을 상태' 를 흉내 내려면 분야별 기준이 필요합니다
    cap_by_cat: dict[int, int] = {}
    for i, cat in enumerate(cats, 1):
        cap = cap_for(cat, caps, store_code)
        cap_by_cat[cat["id"]] = cap
        q = (client.table("rankings")
             .select("snapshot_date", count="exact")
             .eq("category_id", cat["id"]).gt("rank", cap).limit(1))
        n = q.execute().count or 0
        if not n:
            continue
        total += n
        label = f"{store_code.get(cat['store_id'], '?')} {cat.get('name')}"
        print(f"   [{i:3d}/{len(cats)}] {label} — {cap}위 초과 {n:,}줄", end="")
        if dry:
            print("  (확인만)")
            continue
        (client.table("rankings").delete()
         .eq("category_id", cat["id"]).gt("rank", cap).execute())
        print("  ✅")
    print(f"   → 합계 {total:,}줄" + (" (지우지 않았습니다)" if dry else " 지웠습니다"))

    # -------------------------------------------------------------------
    #  ② 순위가 한 줄도 안 남은 상품
    # -------------------------------------------------------------------
    print("-" * 66)
    print("② 순위가 한 줄도 안 남은 상품을 지웁니다")
    print("   ⚠️ 대표님 결정이 걸린 상품은 순위가 없어도 남깁니다.")

    ids = [r["id"] for r in db._select_all(
        lambda: client.table("store_books").select("id").order("id"))]
    print(f"   상품 {len(ids):,}개를 {BATCH}개씩 나눠 봅니다.")

    gone = kept = 0
    for start in range(0, len(ids), BATCH):
        chunk = ids[start:start + BATCH]

        # 🚨 【2026-08-11 저녁 — 확인만 했을 때 숫자가 4배 틀렸습니다】
        # 확인만(dry) 하면 ① 이 아직 안 지웠으므로, 여기서 순위를 그냥
        # 세면 **지울 것이 없는 것처럼** 보입니다. 실제로 대표님께
        # "19,717개" 라고 말씀드렸는데 진짜로 돌리니 80,411개였습니다.
        # 대표님은 4배 작은 숫자를 보고 승인하신 셈입니다.
        #
        # 그래서 확인만 할 때는 **① 이 지웠을 상태를 흉내 내서** 셉니다.
        # 기준을 넘는 순위 줄은 없는 셈 칩니다.
        # 🚨🚨 【2026-08-11 — 여기서 자료를 잃었습니다】
        # 예전에는 이 조회를 그냥 .execute() 했습니다. 그런데 Supabase 는
        # **한 번에 1,000줄까지만** 돌려줍니다. 상품 300개의 순위 줄은
        # 4,000줄이 넘기 때문에, 뒤쪽 상품들은 '순위가 하나도 없는 책'
        # 처럼 보였습니다. 그래서 **순위에 멀쩡히 있던 책이 지워졌고**,
        # 데이터베이스가 그 책의 순위 줄까지 함께 지웠습니다
        # (rankings 는 store_books 에 ON DELETE CASCADE 로 걸려 있습니다).
        # 대표님이 "서점별에서 순위가 누락된 게 굉장히 많다" 고 하신
        # 것이 이것입니다.
        #
        # db._select_all 은 바로 이 1,000줄 한계 때문에 만들어 둔
        # 도구인데, 정작 가장 위험한 자리에서 안 썼습니다.
        rows = db._select_all(
            lambda: client.table("rankings")
            .select("store_book_id,category_id,rank")
            .in_("store_book_id", chunk)
            .order("store_book_id")
        )
        alive = {
            r["store_book_id"] for r in rows
            if not dry or r["rank"] <= cap_by_cat.get(r["category_id"], 300)
        }

        cand = [i for i in chunk if i not in alive]
        if not cand:
            continue

        # 사람이 내린 결정이 걸린 상품은 빼냅니다 (양쪽 칸 모두 확인)
        # ⚠️ 여기도 1,000줄 한계가 있습니다. 빠뜨리면 지키려던 결정이
        #    지워집니다. 반드시 나눠서 전부 읽어야 합니다.
        locked: set[int] = set()
        for col in ("store_book_a", "store_book_b"):
            got = db._select_all(
                lambda c=col: client.table("book_matches").select(c)
                .in_(c, cand)
                .in_("decision", ["manual_merge", "manual_split"])
                .order("id")
            )
            locked.update(r[col] for r in got)

        drop = [i for i in cand if i not in locked]
        kept += len(locked)
        if not drop:
            continue
        gone += len(drop)
        if not dry:
            client.table("store_books").delete().in_("id", drop).execute()
        if (start // BATCH) % 40 == 0:
            print(f"      … {start + len(chunk):,}/{len(ids):,} 확인 "
                  f"(지울 것 {gone:,} · 결정 때문에 남김 {kept:,})")

    print(f"   → 지울 상품 {gone:,}개" + (" (지우지 않았습니다)" if dry else " 지웠습니다"))
    print(f"   → 대표님 결정 때문에 남긴 상품 {kept:,}개")

    # -------------------------------------------------------------------
    #  ③ 딸린 책이 하나도 없어진 도서 묶음
    # -------------------------------------------------------------------
    print("-" * 66)
    print("③ 딸린 책이 없어진 도서 묶음을 지웁니다")
    if dry:
        print("   (확인만 — 건너뜁니다)")
    else:
        used = {r["book_id"] for r in db._select_all(
            lambda: client.table("store_books").select("book_id")
            .not_.is_("book_id", "null").order("id")) if r.get("book_id")}
        removed = db.delete_orphan_books(client, used)
        print(f"   → {removed:,}개 지웠습니다")

    # -------------------------------------------------------------------
    #  🔒 대표님 결정이 그대로인지
    # -------------------------------------------------------------------
    after = (client.table("book_matches")
             .select("id", count="exact")
             .in_("decision", ["manual_merge", "manual_split"])
             .limit(1).execute().count or 0)
    print("=" * 66)
    if after == before:
        print(f"🔒 대표님이 내리신 결정 {after:,}건 — 그대로입니다. ✅")
    else:
        print(f"🚨 대표님 결정이 {before:,} → {after:,} 로 줄었습니다!")
        print("   즉시 알려 주세요. 지우면 안 되는 것을 지웠습니다.")
        return 1

    print("\n다음 수집부터는 일간 300위 · 주간 500위까지만 모읍니다.")
    print("며칠 뒤 db/space-growth.sql 을 다시 돌려서, 늘어나는 속도가")
    print("실제로 얼마나 줄었는지 확인해야 합니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
