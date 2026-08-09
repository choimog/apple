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
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import config as cfg  # noqa: E402

# 무료 요금제 한도
FREE_LIMIT_MB = 500

# 날마다 쌓이고 보관소로 빠져나가는 표.
# ⚠️ archive.py 의 TABLES 와 같아야 합니다. 어긋나면 계산이 조용히 틀립니다.
PER_DAY_TABLES = {"rankings", "book_meta"}

# 코드에 박아 둔 최소 보관 일수 (archive.py 의 ABSOLUTE_MIN_KEEP_DAYS)
MIN_KEEP_DAYS = 14


def project(rows: list[dict], n_days: int, keep: int,
            limit: int = FREE_LIMIT_MB) -> dict:
    """
    rows   : table_sizes() 결과 [{table_name, total_bytes, ...}]
    n_days : 지금 DB 에 들어 있는 수집 날짜 수
    keep   : 보관 일수 (config/archive.yaml 의 keep_days)
    """
    days = max(1, int(n_days or 1))
    keep = max(MIN_KEEP_DAYS, int(keep or MIN_KEEP_DAYS))

    def mb(v) -> float:
        return float(v or 0) / 1_000_000

    total = sum(mb(r.get("total_bytes")) for r in rows)
    daily = sum(mb(r.get("total_bytes")) for r in rows
                if r.get("table_name") in PER_DAY_TABLES)
    catalog = max(0.0, total - daily)

    # 하루에 늘어나는 양 — '순위 자료만' 셉니다. 이것만이 정말 날마다 늡니다.
    per_day = daily / days

    # 보관 작업이 자리를 잡았을 때 도달할 최대치.
    # 도서 목록은 보관소로 안 빠지므로 그대로 더합니다.
    steady = catalog + per_day * keep

    left = max(0.0, limit - total)
    days_left = int(left / per_day) if per_day > 0 else 999

    # 무엇이 문제인지. 차례가 중요합니다 — 구조적인 문제를 먼저 알려야
    # 합니다. '며칠 남았다' 만 보면 보관 일수를 줄여야 한다는 걸 모릅니다.
    problem = None
    if steady > limit:
        problem = (
            f"보관 {keep}일을 유지하면 {steady:.0f}MB 가 되어 한도({limit}MB)를 "
            f"넘습니다. 보관 일수를 줄이거나 저장 항목을 줄여야 합니다."
        )
    elif days_left < 7:
        problem = f"보관이 시작되기 전에 한도에 닿습니다 (약 {days_left}일 뒤)."
    elif total > limit * 0.9:
        problem = "이미 한도의 90% 를 넘겼습니다."

    return {
        "total": total, "daily": daily, "catalog": catalog,
        "per_day": per_day, "steady": steady, "days_left": days_left,
        "keep": keep, "problem": problem,
    }


def describe(p: dict, top: str, limit: int = FREE_LIMIT_MB) -> str:
    return (
        f"  전체        {p['total']:.0f}MB / {limit}MB\n"
        f"  순위 자료   {p['daily']:.0f}MB (하루 약 {p['per_day']:.1f}MB · 보관소로 빠져나감)\n"
        f"  도서 목록   {p['catalog']:.0f}MB (거의 안 늘어남 · 보관소로 안 빠짐)\n"
        f"  보관 {p['keep']}일 유지 시 예상 최대 {p['steady']:.0f}MB\n"
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
    p = project(rows, n_days, int(acfg.get("keep_days", MIN_KEEP_DAYS)))

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
        print("  1) config/archive.yaml 의 keep_days 를 줄입니다")
        print(f"     (지금 {p['keep']}일. 최소 {MIN_KEEP_DAYS}일까지 내려갑니다)")
        print("     자료가 사라지는 게 아니라 보관 파일로 빠집니다.")
        print("     사이트에서 바로 볼 수 있는 기간만 짧아집니다.")
        print("  2) 그래도 모자라면 저에게 말씀해 주세요.")
        print("     저장하는 항목을 줄이는 방법을 찾아보겠습니다.")
        return 1

    print("\n  ✅ 여유 있습니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
