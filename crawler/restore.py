"""
=============================================================================
 불러오기 — 보관소(R2)에 있는 날짜를 사이트로 다시 되돌립니다
=============================================================================

 【왜 필요한가요? — 2026-08-08 대표님 결정】
 무료 요금제로 가기로 하셨습니다. 그러면 사이트에서 바로 보이는 기간이
 약 2주뿐입니다. 그보다 오래된 자료는 보관소에 파일로 있습니다.

 예전에는 그 파일을 손으로 내려받아 엑셀로 봐야 했습니다.
 이제는 이 작업으로 **원하는 기간을 사이트로 잠깐 되돌릴 수 있습니다.**

   "6월 한 달치를 다시 보고 싶다" → 이 작업 실행 → 몇 분 뒤 사이트에서 보임

 【다시 내보내려면】
 그냥 두시면 됩니다. 매주 월요일 [보관소로 옮기기] 가 자동으로 다시
 내보냅니다. 파일은 보관소에 그대로 있으므로 몇 번이든 되돌릴 수 있습니다.

 【안전장치】
  1. 보관소의 파일 지문(sha256)이 기록과 다르면 넣지 않습니다
  2. 이미 사이트에 있는 날짜는 건너뜁니다 (덮어쓰지 않습니다)
  3. --dry-run 으로 무엇을 되돌릴지 먼저 볼 수 있습니다
  4. 한 번에 되돌릴 수 있는 날짜 수를 제한합니다 (용량 사고 방지)

 【실행】
 GitHub → Actions → [보관소에서 불러오기] → Run workflow
=============================================================================
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import db  # noqa: E402
from archive import TABLES, make_client  # noqa: E402

# 한 번에 되돌릴 수 있는 최대 날짜 수.
# 무료 요금제(500MB)에서 한꺼번에 너무 많이 되돌리면 용량이 터집니다.
MAX_DATES_PER_RUN = 31

# 되돌린 뒤 남은 용량이 이보다 적어질 것 같으면 멈춥니다 (MB)
SAFETY_MARGIN_MB = 60


def parse_day(s: str) -> date:
    return datetime.strptime(s.strip(), "%Y-%m-%d").date()


def rows_of(data: bytes) -> list[dict]:
    """압축된 파일을 다시 줄 목록으로"""
    text = gzip.decompress(data).decode()
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", default="", help="시작 날짜 YYYY-MM-DD")
    ap.add_argument("--to", dest="end", default="", help="끝 날짜 YYYY-MM-DD")
    ap.add_argument("--dry-run", action="store_true", help="무엇을 되돌릴지 보기만")
    args = ap.parse_args()

    start_s = args.start or os.environ.get("FROM_DATE", "").strip()
    end_s = args.end or os.environ.get("TO_DATE", "").strip()
    dry_run = args.dry_run or os.environ.get("DRY_RUN", "").lower() == "true"

    if not start_s:
        print("❌ 시작 날짜를 지정하세요 (예: 2026-06-01)")
        return 1
    start = parse_day(start_s)
    end = parse_day(end_s) if end_s else start
    if end < start:
        start, end = end, start

    days = (end - start).days + 1
    if days > MAX_DATES_PER_RUN:
        print(f"❌ 한 번에 되돌릴 수 있는 날짜는 최대 {MAX_DATES_PER_RUN}일입니다.")
        print(f"   지금 요청하신 기간은 {days}일입니다. 나눠서 실행해 주세요.")
        return 1

    print("=" * 66)
    print(f"  보관소에서 불러오기 — {start} ~ {end} ({days}일)")
    print(f"  모드: {'확인만 (되돌리지 않음)' if dry_run else '실제로 되돌림'}")
    print("=" * 66)

    s3, bucket = make_client()
    if not s3:
        print("\n보관소 접속 정보가 없습니다. 아무것도 하지 않았습니다.")
        print("  docs/archive-setup.md 의 5단계(GitHub Secrets 등록)를 확인하세요.")
        return 1

    client = db.connect()

    # 보관 기록을 읽습니다
    res = (
        client.table("archives")
        .select("snapshot_date,table_name,object_key,row_count,sha256,deleted_from_db")
        .gte("snapshot_date", start.isoformat())
        .lte("snapshot_date", end.isoformat())
        .execute()
    )
    records = res.data or []
    if not records:
        print("\n이 기간에 보관된 자료가 없습니다.")
        print("  아직 보관소로 옮겨지지 않았거나(=사이트에 이미 있음),")
        print("  그날은 수집 자체가 없었을 수 있습니다.")
        return 0

    todo = [r for r in records if r.get("deleted_from_db")]
    already = len(records) - len(todo)
    if already:
        print(f"\n  ℹ️ {already}건은 이미 사이트에 있습니다 (건너뜁니다)")
    if not todo:
        print("\n되돌릴 것이 없습니다. 요청하신 기간은 이미 사이트에서 볼 수 있습니다.")
        return 0

    total_rows = sum(r["row_count"] for r in todo)
    est_mb = round(total_rows * 200 / 1_000_000, 1)
    print(f"\n  되돌릴 것: {len(todo)}건 · {total_rows:,}줄 · 약 {est_mb}MB")

    if dry_run:
        for r in sorted(todo, key=lambda x: (x["snapshot_date"], x["table_name"])):
            print(f"    · {r['snapshot_date']}  {r['table_name']:<10} "
                  f"{r['row_count']:>8,}줄")
        print("\n[확인만 함] 실제로 되돌리려면 dry_run 을 false 로 두고 다시 실행하세요.")
        return 0

    print("\n▶ 되돌리는 중...")
    restored = 0
    failed = 0

    for r in sorted(todo, key=lambda x: (x["snapshot_date"], x["table_name"])):
        day = r["snapshot_date"]
        table = r["table_name"]
        if table not in TABLES:
            print(f"  ⚠️ 모르는 표라 건너뜀: {table}")
            continue

        try:
            obj = s3.get_object(Bucket=bucket, Key=r["object_key"])
            data = obj["Body"].read()
        except Exception as exc:  # noqa: BLE001
            print(f"  ❌ {day} {table}: 파일을 못 읽었습니다 — {exc}")
            failed += 1
            continue

        # 안전장치 ① 지문이 다르면 넣지 않습니다
        got = hashlib.sha256(data).hexdigest()
        if got != r["sha256"]:
            print(f"  ❌ {day} {table}: 파일 지문이 기록과 다릅니다. 넣지 않았습니다.")
            print(f"       기록 {r['sha256'][:16]}… / 파일 {got[:16]}…")
            failed += 1
            continue

        rows = rows_of(data)
        # 안전장치 ② 줄 수가 기록과 다르면 넣지 않습니다
        if len(rows) != r["row_count"]:
            print(f"  ❌ {day} {table}: 줄 수가 다릅니다 "
                  f"(기록 {r['row_count']:,} / 파일 {len(rows):,}). 넣지 않았습니다.")
            failed += 1
            continue

        try:
            for i in range(0, len(rows), 500):
                client.table(table).upsert(rows[i:i + 500]).execute()
        except Exception as exc:  # noqa: BLE001
            print(f"  ❌ {day} {table}: 저장 실패 — {exc}")
            failed += 1
            continue

        client.table("archives").update({"deleted_from_db": False}).eq(
            "snapshot_date", day
        ).eq("table_name", table).execute()

        print(f"  ✅ {day} {table:<10} {len(rows):>8,}줄 되돌림")
        restored += 1

    print("\n" + "=" * 66)
    print(f"  되돌림 {restored}건 · 실패 {failed}건")
    if restored:
        print("\n  사이트에서 그 기간이 보입니다. (화면 갱신까지 10분 정도 걸릴 수 있습니다)")
        print("  다 보신 뒤에는 그냥 두시면 됩니다 —")
        print("  매주 월요일 [보관소로 옮기기] 가 자동으로 다시 내보냅니다.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
