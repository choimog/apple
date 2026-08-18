"""
=============================================================================
 용량이 언제 차는지 — 매일 수집이 끝난 뒤에 봅니다
=============================================================================

 【왜 매일 보나요?】
 무료 500MB 가 차면 **수집이 실패하고 사이트도 멈춥니다.** 이 프로젝트를
 죽일 수 있는 문제는 사실상 이것 하나입니다. 그런데 예전에는 제가 코드를
 고쳐서 올릴 때만 확인했습니다. 제가 손을 떼면 아무도 안 보게 됩니다.

 【왜 여기(파이썬)에 있나요? — 2026-08-09】
 원래 사이트 쪽 검사(web/scripts)에 있던 것을 옮겼습니다.
 같은 계산을 두 군데 두면 반드시 어긋납니다. 한쪽만 고치게 되니까요.
 그래서 한 곳만 남기고, 매일 도는 쪽에 두었습니다.

 【이 계산이 실제로 거짓말을 한 적이 있습니다】
 2일치만 모인 상태에서 "하루 95.9MB · 3일 뒤 꽉 참" 이라고 알려 왔습니다.
 실제와 4배 넘게 차이 났습니다. "전체 용량 ÷ 날짜 수" 로 냈기 때문입니다.

 표는 성격이 두 가지인데 하나로 뭉뚱그린 것이 원인이었습니다.

   · 날마다 쌓이는 것   rankings, book_meta
                        하루치씩 정직하게 늡니다. 보관소로 빠져나갑니다.
   · 도서 목록          books, store_books, book_matches …
                        '처음 보는 책' 이 나올 때만 늡니다. 첫날에는
                        7만 권이 전부 처음이라 폭발하고, 그 뒤로는 거의
                        안 늡니다. 보관소로도 안 빠집니다.

 첫날의 목록 구축 비용을 '매일 드는 비용' 으로 세면 당연히 과장됩니다.

 틀린 경고는 그냥 틀린 것으로 끝나지 않습니다. 검사가 매번 빨간불이면
 진짜 고장도 같이 묻힙니다. 실제로 그랬습니다.
=============================================================================
"""

from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import config as cfg  # noqa: E402

# 무료 요금제 한도
FREE_LIMIT_MB = 500

# 날마다 쌓이고 보관소로 빠져나가는 표.
# ⚠️ archive.py 의 TABLES 와 같아야 합니다. 어긋나면 계산이 조용히 틀립니다.
#
# 【2026-08-10 — book_meta 가 여기서 빠졌습니다】
# 재 보니 131,351줄 중 60,685줄(46.2%)이 어제와 똑같았고, 사이트는 이
# 자료를 읽지도 않았습니다. 이제 책마다 한 줄만 둡니다(db/meta-slim.sql).
# 날마다 늘지 않으므로 아래 '도서 목록' 쪽으로 옮겨 셉니다.
PER_DAY_TABLES = {"rankings"}

# ---------------------------------------------------------------------------
#  천천히, 그러나 **끝없이** 늘어나는 표
# ---------------------------------------------------------------------------
#  【2026-08-09 대표님 질문에서 찾은 잘못】
#  "리포트가 계속 누적되는 것 때문에 용량 계산에 문제가 생기진 않으려나?"
#
#  확인해 보니 **실제로 문제가 있었습니다.**
#  이 계산은 표를 두 가지로만 나눴습니다.
#    · 날마다 쌓이는 것 (보관소로 빠짐)
#    · 도서 목록 ("거의 안 늘어남")
#  그런데 아래 두 표는 **어느 쪽도 아닙니다.** 날마다 늘어나는데
#  보관소로 빠지지 않습니다. 그런데도 '거의 안 늘어남' 쪽에 들어가 있었습니다.
#
#    · crawl_logs    수집 기록. 하루 208줄(분야 수만큼). 연 7만 줄.
#                    → 이쪽이 진짜 문제입니다.
#    · daily_reports AI 리포트. 하루 1줄. 연 365줄.
#                    → 양은 무시할 만하지만 분류가 틀린 건 같습니다.
#
#  '안 늘어난다' 고 세면 예상 최대치가 계속 실제보다 낮게 나옵니다.
#  낮게 나오는 경고는 안 나오는 경고와 같습니다.
SLOW_GROW_TABLES = {"crawl_logs", "daily_reports"}

# 이 중 지우지 않고 영원히 쌓아 두는 표.
#
# 【2026-08-09 대표님 승인으로 비었습니다】
# "리포트도 기록이 지워질 때, 해당 일자에 해당하는 건 함께 지워줘도 돼."
# 그래서 지금은 둘 다 archive.py 의 prune_logs 가 정리합니다.
#
# ⚠️ 비었다고 이 개념을 지우지 마세요. 나중에 '안 지우는 표' 가 하나라도
#    생기면, 그것을 여기 넣지 않는 순간 용량 계산이 다시 조용히 틀립니다.
#    (바로 그 잘못을 2026-08-09 에 찾아서 고쳤습니다)
NEVER_PRUNED: set[str] = set()

# ---------------------------------------------------------------------------
#  도서 목록 — 🚨 '거의 안 늘어남' 이 아니었습니다 (2026-08-18 실측)
# ---------------------------------------------------------------------------
#  【대표님 질문에서 또 찾은 잘못】
#      "7일 정도 수집됐어. 용량이 얼마나 버틸 수 있을것 같아?"
#
#  db/space-growth.sql 로 재 보니 이랬습니다.
#
#      첫 수집일          36,058줄   ← 이건 앞으로의 속도가 아닙니다
#      그 뒤 하루 평균      6,738줄   ← 이것이 진짜 속도입니다
#      한 줄당 651 bytes
#      → store_books 만으로 1년 뒤 1,574MB
#
#  그런데 이 파일은 store_books·books·book_matches 를 '도서 목록' 으로
#  묶어 **지금 크기 그대로 안 늘어난다** 고 세고 있었습니다.
#  실제로는 전체 증가량의 **58% 가 여기서** 나옵니다.
#
#  바로 위 SLOW_GROW_TABLES 주석에 제가 적어 둔 말이 그대로 적용됩니다.
#      "낮게 나오는 경고는 안 나오는 경고와 같습니다."
#  같은 잘못을 표만 바꿔서 되풀이하고 있었습니다.
#
#  🚨 그렇다고 '전체 ÷ 날짜 수' 로 되돌리면 안 됩니다. 그건 2026-08-09 에
#     4배 넘게 부풀린 바로 그 계산입니다. 첫날은 모든 책이 처음이라
#     혼자 5배를 담습니다. **첫날을 뺀 최근 며칠**로 재야 합니다.
#     그 일을 measure_catalog_growth() 가 합니다.
# ---------------------------------------------------------------------------
CATALOG_TABLES = {"books", "store_books", "book_matches"}

# 도서 목록 증가 속도를 잴 때 볼 날수 (첫 수집일은 제외하고 셉니다)
CATALOG_SAMPLE_DAYS = 3

# 안 지우는 표는 '몇 년 뒤' 를 봐야 합니다.
# 1년으로 잡습니다. 그보다 멀리 보면 숫자가 공상에 가까워집니다.
HORIZON_DAYS = 365

# 코드에 박아 둔 최소 보관 일수 (archive.py 의 ABSOLUTE_MIN_KEEP_DAYS)
MIN_KEEP_DAYS = 14


def project(rows: list[dict], n_days: int, keep: int,
            limit: int = FREE_LIMIT_MB, log_keep: int = 180,
            catalog_per_day: float | None = None,
            catalog_keep_days: int | None = None) -> dict:
    """
    rows              : table_sizes() 결과 [{table_name, total_bytes, ...}]
    n_days            : 지금 DB 에 들어 있는 수집 날짜 수
    keep              : 순위 자료 보관 일수 (config/archive.yaml 의 keep_days)
    log_keep          : 수집 기록 보관 일수 (config/archive.yaml 의 log_keep_days)
    catalog_per_day   : 도서 목록이 하루에 늘어나는 MB.
                        None = **아직 못 쟀음**. 0 과 다릅니다.
                        0 으로 넘기면 '안 늘어난다' 고 단정하는 것이라
                        예전의 그 잘못을 되풀이합니다.
    catalog_keep_days : 도서 목록을 며칠치로 유지하는 정리 장치가 있으면
                        그 일수. None = **그런 장치가 없음** → 영원히 쌓임.
    """
    days = max(1, int(n_days or 1))
    keep = max(MIN_KEEP_DAYS, int(keep or MIN_KEEP_DAYS))
    log_keep = max(1, int(log_keep or 180))

    def mb(v) -> float:
        return float(v or 0) / 1_000_000

    def sum_of(names) -> float:
        return sum(mb(r.get("total_bytes")) for r in rows
                   if r.get("table_name") in names)

    total = sum(mb(r.get("total_bytes")) for r in rows)
    daily = sum_of(PER_DAY_TABLES)
    slow = sum_of(SLOW_GROW_TABLES)
    catalog = max(0.0, total - daily - slow)

    # 하루에 늘어나는 양
    per_day = daily / days              # 순위 자료 (보관소로 빠짐)
    slow_per_day = slow / days          # 기록·리포트 (안 빠짐)

    # 지우는 것과 안 지우는 것을 나눠서 봐야 합니다.
    pruned_slow = sum_of(SLOW_GROW_TABLES - NEVER_PRUNED) / days
    kept_slow = sum_of(NEVER_PRUNED) / days

    # 🚨 도서 목록이 하루에 얼마나 늘어나는가.
    #    None(못 쟀음) 과 0(안 늘어남) 을 절대 같이 다루면 안 됩니다.
    cat_measured = catalog_per_day is not None
    cat_per_day = float(catalog_per_day or 0.0)

    # 1년 뒤 예상 최대치.
    #   · 순위 자료   : 보관 일수만큼만 남음
    #   · 수집 기록   : 기록 보관 일수만큼만 남음
    #   · 리포트      : 안 지우므로 1년치가 그대로 쌓임
    #   · 도서 목록   : 정리 장치가 있으면 그 일수만큼, 없으면 1년치가 쌓임
    if catalog_keep_days:
        catalog_steady = cat_per_day * int(catalog_keep_days)
    else:
        catalog_steady = catalog + cat_per_day * HORIZON_DAYS

    steady = (
        catalog_steady
        + per_day * keep
        + pruned_slow * log_keep
        + kept_slow * HORIZON_DAYS
    )

    # '이대로 두면 며칠 남았나' 도 안 지우는 것까지 세야 정직합니다
    grow_per_day = per_day + slow_per_day + cat_per_day
    left = max(0.0, limit - total)
    days_left = int(left / grow_per_day) if grow_per_day > 0 else 999

    # 무엇이 문제인지. 차례가 중요합니다 — 구조적인 문제를 먼저 알려야
    # 합니다. '며칠 남았다' 만 보면 보관 일수를 줄여야 한다는 걸 모릅니다.
    problem = None
    if not cat_measured:
        # 못 쟀으면 **모른다고 말해야** 합니다. 조용히 0 으로 세면
        # 예상치가 늘 실제보다 낮게 나와 경고가 영영 안 뜹니다.
        problem = (
            "도서 목록(books·store_books·book_matches)이 하루에 얼마나 "
            "늘어나는지 재지 못했습니다. 이 값 없이는 예상치가 실제보다 "
            "낮게 나옵니다."
        )
    elif catalog_keep_days is None and cat_per_day > 0:
        problem = (
            f"도서 목록이 하루 {cat_per_day:.1f}MB 씩 늘어나는데 이것을 "
            f"정리하는 장치가 없습니다. 1년 뒤 {catalog_steady:.0f}MB 가 "
            f"됩니다 (한도 {limit}MB). 순위에서 빠진 지 오래된 상품을 "
            f"정리해야 합니다."
        )
    elif steady > limit:
        problem = (
            f"이대로 1년이 지나면 {steady:.0f}MB 가 되어 한도({limit}MB)를 "
            f"넘습니다. 보관 일수를 줄이거나 저장 항목을 줄여야 합니다."
        )
    elif days_left < 7:
        problem = f"보관이 시작되기 전에 한도에 닿습니다 (약 {days_left}일 뒤)."
    elif total > limit * 0.9:
        problem = "이미 한도의 90% 를 넘겼습니다."

    return {
        "total": total, "daily": daily, "catalog": catalog, "slow": slow,
        "per_day": per_day, "slow_per_day": slow_per_day,
        "catalog_per_day": cat_per_day, "catalog_measured": cat_measured,
        "catalog_keep": catalog_keep_days,
        "steady": steady, "days_left": days_left,
        "keep": keep, "log_keep": log_keep, "problem": problem,
    }


def measure_catalog_growth(client, rows: list[dict], n_days: int,
                           sample_days: int = CATALOG_SAMPLE_DAYS
                           ) -> float | None:
    """
    도서 목록이 하루에 몇 MB 늘어나는지 잽니다. 못 재면 None.

    🚨 첫 수집일은 반드시 빼야 합니다. 그날은 모든 책이 '처음 보는 책'
       이라 평소의 대여섯 배가 한꺼번에 들어옵니다(실측 36,058 vs 6,738).
       그 값을 '매일 드는 비용' 으로 세면 2026-08-09 처럼 4배 넘게
       부풀려지고, 매번 빨간불이 되어 진짜 고장이 묻힙니다.

       그래서 **최근 며칠에 새로 생긴 상품만** 셉니다. 첫 수집일은
       그 창 밖으로 밀려나 있으므로 자연히 빠집니다.
    """
    # 첫날 하루뿐이면 '그 뒤' 가 없습니다. 지어내지 않고 모른다고 합니다.
    if int(n_days or 0) < 2:
        return None

    by_name = {r.get("table_name"): r for r in rows}
    sb = by_name.get("store_books") or {}
    sb_rows = int(sb.get("row_count") or 0)
    if sb_rows <= 0:
        return None

    catalog_bytes = sum(
        float(by_name[t].get("total_bytes") or 0)
        for t in CATALOG_TABLES if t in by_name
    )
    if catalog_bytes <= 0:
        return None

    # 첫 수집일이 창 안에 들어오지 않도록 창을 좁힙니다.
    window = max(1, min(int(sample_days), int(n_days) - 1))
    today = date.today()
    start = (today - timedelta(days=window)).isoformat()

    try:
        res = (
            client.table("store_books")
            .select("id", count="exact", head=True)
            .gte("first_seen_at", start)
            # ⚠️ 오늘은 뺍니다. 이 검사는 수집 직후에 도는데, 수집이 아직
            #    안 끝났거나 실패한 날이 섞이면 '하루치' 가 반쪽이 됩니다.
            #    그러면 늘어나는 속도를 실제보다 낮게 봅니다.
            #    빼면 딱 window 일치의 **완전한** 날만 남습니다.
            .lt("first_seen_at", today.isoformat())
            .execute()
        )
        new_rows = int(res.count or 0)
    except Exception as exc:  # noqa: BLE001
        print(f"  ℹ️ 도서 목록 증가 속도를 재지 못했습니다: {exc}")
        return None

    if new_rows <= 0:
        return None

    # 상품 한 줄이 실제로 끌고 오는 무게(books·book_matches 포함)로 셉니다.
    # store_books 만 세면 절반 넘게 빠집니다 (48MB vs 136MB).
    return (new_rows / window) * (catalog_bytes / sb_rows) / 1_000_000


def describe(p: dict, top: str, limit: int = FREE_LIMIT_MB) -> str:
    if not p["catalog_measured"]:
        cat = "🚨 하루에 얼마나 느는지 못 쟀음 · 보관소로 안 빠짐"
    elif p["catalog_keep"]:
        cat = (f"하루 약 {p['catalog_per_day']:.1f}MB · "
               f"{p['catalog_keep']}일치로 정리됨")
    else:
        cat = (f"🚨 하루 약 {p['catalog_per_day']:.1f}MB · "
               f"정리하는 장치가 없어 계속 쌓임")
    return (
        f"  전체        {p['total']:.0f}MB / {limit}MB\n"
        f"  순위 자료   {p['daily']:.0f}MB "
        f"(하루 약 {p['per_day']:.1f}MB · 보관소로 빠져나감)\n"
        f"  기록·리포트 {p['slow']:.0f}MB "
        f"(하루 약 {p['slow_per_day']:.2f}MB · 천천히 늘고 보관소로 안 빠짐)\n"
        f"  도서 목록   {p['catalog']:.0f}MB ({cat})\n"
        f"  1년 뒤 예상 최대 {p['steady']:.0f}MB "
        f"(순위 {p['keep']}일 · 기록 {p['log_keep']}일 보관 기준)\n"
        f"  이대로 두면 {p['days_left']}일 뒤 한도\n"
        f"  큰 표: {top}"
    )


def main() -> int:
    from common import db  # 여기서 불러야 시험이 DB 없이 돕니다

    client = db.connect()
    try:
        res = client.rpc("table_sizes").execute()
        rows = res.data or []
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        if "function" in msg or "does not exist" in msg or "schema cache" in msg:
            print("ℹ️ 용량 확인을 건너뜁니다 — db/perf.sql 을 아직 실행하지 않았습니다.")
            return 0
        print(f"⚠️ 용량을 읽지 못했습니다: {msg}")
        return 0  # 용량을 못 읽었다고 수집을 실패로 만들 이유는 없습니다

    if not rows:
        print("ℹ️ 표 크기를 읽지 못했습니다 (빈 결과).")
        return 0

    try:
        dates = client.rpc("snapshot_dates", {"n": 400}).execute().data or []
        n_days = len(dates)
    except Exception:  # noqa: BLE001
        n_days = 1

    acfg = cfg.load("archive.yaml")
    # 🚨 도서 목록 증가 속도는 **재서** 넣습니다. 안 넣으면 예상치가
    #    늘 실제보다 낮게 나와 경고가 영영 안 뜹니다 (2026-08-18 실측).
    cat_per_day = measure_catalog_growth(client, rows, n_days)
    cat_keep = acfg.get("catalog_keep_days")
    p = project(
        rows,
        n_days,
        int(acfg.get("keep_days", MIN_KEEP_DAYS)),
        log_keep=int(acfg.get("log_keep_days", 180)),
        catalog_per_day=cat_per_day,
        catalog_keep_days=int(cat_keep) if cat_keep else None,
    )

    top = " · ".join(
        f"{r['table_name']} {float(r.get('total_bytes') or 0) / 1_000_000:.0f}MB"
        for r in rows[:4]
    )

    print("=" * 66)
    print("  데이터베이스 용량")
    print("=" * 66)
    print(describe(p, top))

    if p["problem"]:
        print("\n" + "=" * 66)
        print(f"  🚨 {p['problem']}")
        print("=" * 66)
        print("\n  【무엇을 하면 되나요?】")
        if p["catalog_measured"] and not p["catalog_keep"]:
            # 이 경우엔 보관 일수를 줄여도 소용이 없습니다. 순위가 아니라
            # 도서 목록이 늘어나는 것이라, 엉뚱한 곳을 가리키면 안 됩니다.
            print("  1) 순위에서 빠진 지 오래된 상품을 정리해야 합니다.")
            print("     보관 일수를 줄여도 이건 안 줄어듭니다. 늘어나는 것이")
            print("     순위 자료가 아니라 도서 목록이기 때문입니다.")
            print("     → 대표님 승인이 필요한 작업입니다. 말씀해 주세요.")
            print("  2) 안 쓰는 색인을 지우면 당장 자리가 납니다")
            print("     (db/space-index.sql · 자료는 하나도 안 지웁니다)")
        else:
            print("  1) config/archive.yaml 의 keep_days 를 줄입니다")
            print(f"     (지금 {p['keep']}일. 최소 {MIN_KEEP_DAYS}일까지 내려갑니다)")
            print(f"     수집 기록도 log_keep_days 로 줄일 수 있습니다 "
                  f"(지금 {p['log_keep']}일)")
            print("     자료가 사라지는 게 아니라 보관 파일로 빠집니다.")
            print("     사이트에서 바로 볼 수 있는 기간만 짧아집니다.")
            print("  2) 그래도 모자라면 저에게 말씀해 주세요.")
            print("     저장하는 항목을 줄이는 방법을 찾아보겠습니다.")
        return 1

    print("\n  ✅ 여유 있습니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
