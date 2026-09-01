"""
=============================================================================
 오늘 어느 서점을 수집할지 정합니다
=============================================================================

 【왜 따로 만들었나요? — 2026-09-01 대표님 지적】
   "계속 자동 수집 시간이 늦어지고 있어."

 GitHub 의 예약은 정시에 안 옵니다. 실제로 이렇게 돌았습니다.

     예정 08:00  →  실제 10:02 · 10:07 · 10:38 · 13:03 · 15:31

 늦는 것보다 더 나쁜 것은 **아예 안 오는 날**입니다. 2주 사이에
 8/26 과 8/31 이 통째로 빠졌습니다. 그날 자료는 영영 없습니다
 (서점은 '오늘' 순위만 보여 주므로 나중에 되받을 수 없습니다).

 그래서 아침에 한 번 더 예약을 걸어 두고, 이 파일이 **이미 받은
 서점은 빼고** 못 받은 서점만 돌리게 합니다.

   · 평소(06:17) 실행     → 3사 전부
   · 따라잡기(09:11) 실행 → 오늘 아직 못 받은 서점만. 다 받았으면 아무것도 안 함

 ⚠️ 서점에 요청을 두 번 보내지 않습니다. 이미 받았으면 건너뜁니다.

 【결과를 어떻게 넘기나요】
 GitHub Actions 가 읽을 수 있게 stores=["kyobo",…] 한 줄을 찍습니다.

 실행: python crawler/plan_stores.py
   ONLY_STORE  한 서점만 (비우면 설정된 전체)
   CATCHUP     true 면 '못 받은 것만'
=============================================================================
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import config as cfg  # noqa: E402

KST = timezone(timedelta(hours=9))

# 수집이 '됐다' 고 볼 최소 건수.
#
# ⚠️ 0 건이면 안 됩니다. 실패한 기록도 crawl_logs 에 남기 때문에,
#    "기록이 있으니 받았다" 로 보면 **실패한 날을 영영 안 고칩니다.**
#    한 서점이 한 분야만 성공해도 보통 수백 권이 들어옵니다.
MIN_ITEMS = 100

# 데이터베이스를 못 읽었을 때만 쓰는 기본값 (db/schema.sql 과 같아야 합니다)
DEFAULT_STORE_IDS = {"kyobo": 1, "yes24": 2, "aladin": 3}


def out(stores: list[str], why: str) -> int:
    print(f"  → {why}")
    print(f"  → 이번에 돌릴 서점: {stores if stores else '없음'}")
    path = os.environ.get("GITHUB_OUTPUT")
    line = "stores=" + json.dumps(stores)
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    else:
        print(line)
    return 0


def main() -> int:
    only = os.environ.get("ONLY_STORE", "").strip()
    catchup = os.environ.get("CATCHUP", "").strip().lower() == "true"

    # ⚠️ sources.yaml 의 열쇠는 'kyobo_online' · 'yes24_weekly' 처럼
    #    나뉘어 있습니다. 서점 이름은 그 안의 `store:` 값입니다.
    #    (열쇠 이름으로 찾으면 교보가 통째로 빠집니다 — 실제로 겪음)
    sources = cfg.load("sources.yaml")
    seen: list[str] = []
    for name, block in sources.items():
        if name == "defaults" or not isinstance(block, dict):
            continue
        code = str(block.get("store", "")).strip()
        if code and code not in seen:
            seen.append(code)
    all_stores = seen or ["kyobo", "yes24", "aladin"]

    wanted = [only] if only else all_stores

    print("=" * 66)
    print("  오늘 어느 서점을 수집할지")
    print(f"  방식: {'따라잡기 (못 받은 것만)' if catchup else '평소 (전부)'}")
    print("=" * 66)

    if not catchup:
        return out(wanted, "평소 실행이라 그대로 돕니다")

    # ---- 따라잡기: 오늘 이미 받은 서점을 빼냅니다 ----
    today = datetime.now(KST).date().isoformat()

    try:
        from common import db  # 여기서 불러야 설정만 볼 때 DB 가 필요 없습니다

        client = db.connect()
        res = (
            client.table("crawl_logs")
            .select("store_id,status,items_collected")
            .eq("snapshot_date", today)
            .execute()
        )
        rows = res.data or []
    except Exception as exc:  # noqa: BLE001
        # 🚨 못 물어봤으면 **전부 돌립니다.**
        #    "모르니까 건너뛴다" 로 하면, 물어보기가 실패한 날은 수집도
        #    안 됩니다. 한 번 더 받는 것이 안 받는 것보다 낫습니다.
        print(f"  ⚠️ 오늘 기록을 확인하지 못했습니다: {exc}")
        return out(wanted, "확인 실패 — 안전하게 전부 돌립니다")

    got: dict[int, int] = {}
    for r in rows:
        if r.get("status") != "success":
            continue
        sid = r.get("store_id")
        if sid is None:
            continue
        got[sid] = got.get(sid, 0) + int(r.get("items_collected") or 0)

    # 서점 번호는 **데이터베이스에서 읽습니다.** 여기에 1·2·3 을 적어 두면
    # 나중에 서점이 하나 늘었을 때 조용히 어긋납니다 (그 서점만 영영
    # '아직 안 받음' 이 되어 매일 두 번 수집합니다).
    id_of = DEFAULT_STORE_IDS
    try:
        srows = client.table("stores").select("id,code").execute().data or []
        found = {r["code"]: int(r["id"]) for r in srows if r.get("code")}
        if found:
            id_of = found
    except Exception as exc:  # noqa: BLE001
        print(f"  ⚠️ 서점 번호를 못 읽어 기본값을 씁니다: {exc}")

    done = {name for name, sid in id_of.items() if got.get(sid, 0) >= MIN_ITEMS}

    print(f"\n  오늘({today}) 이미 받은 것")
    for name in all_stores:
        n = got.get(id_of.get(name, -1), 0)
        mark = "✅ 받음" if name in done else "❌ 아직"
        print(f"    {mark}  {name:<7} {n:,}권")

    todo = [s for s in wanted if s not in done]
    if not todo:
        return out([], "3사 모두 이미 받았습니다. 아무것도 안 합니다")
    return out(todo, "아직 못 받은 서점만 돌립니다")


if __name__ == "__main__":
    raise SystemExit(main())
