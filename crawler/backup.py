"""
=============================================================================
 백업 — 데이터베이스 전체를 보관소(R2)에 통째로 저장합니다
=============================================================================

 【왜 필요한가요? — 2026-08-08 대표님 결정】
 Supabase 무료 요금제로 가기로 하셨습니다. 무료에는 **자동 백업이 없습니다.**
 유료(Pro)가 주는 것 중 용량은 보관소로 해결되지만, 백업은 안 됩니다.

 그래서 매주 데이터베이스 전체를 압축해 보관소에 넣습니다.
 R2 무료 10GB 안에서 도므로 **비용은 0원**입니다.

 【보관소로 옮기기(archive.py) 와 무엇이 다른가요?】

   archive.py  오래된 순위를 옮기고 DB 에서 **지웁니다** (용량 확보가 목적)
   backup.py   지금 있는 것을 통째로 **복사만** 합니다 (사고 대비가 목적)

 백업은 아무것도 지우지 않습니다. 읽기만 합니다.

 【무엇을 백업하나요?】
 순위표(rankings)는 archive.py 가 이미 보관소에 날짜별로 넣고 있으므로
 빼고, **다시 만들 수 없는 것들**만 담습니다.

   · books        묶은 결과 (다시 만들려면 매칭을 처음부터 돌려야 함)
   · store_books  서점별 도서 (수집을 다시 해도 과거 것은 못 되살림)
   · book_matches 사람이 내린 판단  ← 이게 가장 중요합니다
   · categories / stores / crawl_logs / archives

 사람이 "이건 같은 책" 이라고 누른 판단은 **어디에도 다시 없습니다.**
 이걸 잃으면 되살릴 방법이 없습니다.

 【몇 개를 남기나요?】
 최근 8개(약 2개월치)만 남기고 오래된 것은 지웁니다.

 【실행】
 매주 월요일 자동. 손으로 돌리려면
 GitHub → Actions → [백업] → Run workflow
=============================================================================
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import db  # noqa: E402
from archive import make_client  # noqa: E402

# 백업할 표와, 그 표를 나눠 읽을 때 정렬할 열.
# ※ rankings 는 넣지 않습니다. archive.py 가 날짜별로 이미 보관합니다.
#   (하루 11만 줄이라 매주 통째로 담으면 보관소가 금방 찹니다)
TABLES = {
    "stores": "id",
    "categories": "id",
    "books": "id",
    "store_books": "id",
    "book_matches": "id",
    "crawl_logs": "id",
    "archives": "id",
}

# 최근 몇 개를 남길지 (약 2개월치)
KEEP_BACKUPS = 8


def fetch_all(client, table: str, order_col: str) -> list[dict]:
    """표 전체를 나눠서 읽습니다 (한 번에 1,000행 제한)."""
    out: list[dict] = []
    step = 1000
    start = 0
    while True:
        res = (
            client.table(table)
            .select("*")
            .order(order_col)
            .range(start, start + step - 1)
            .execute()
        )
        rows = res.data or []
        out.extend(rows)
        if len(rows) < step:
            return out
        start += step


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="담기만 하고 올리지 않음")
    args = ap.parse_args()
    dry_run = args.dry_run or os.environ.get("DRY_RUN", "").lower() == "true"

    # 파일 이름에 쓸 시각. 실행 환경의 시계를 그대로 씁니다.
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")

    print("=" * 66)
    print(f"  백업 — {stamp}")
    print(f"  모드: {'확인만 (올리지 않음)' if dry_run else '실제로 올림'}")
    print("=" * 66)

    s3, bucket = make_client()
    if not s3 and not dry_run:
        print("\n보관소 접속 정보가 없습니다. 아무것도 하지 않았습니다.")
        print("  docs/archive-setup.md 의 5단계(GitHub Secrets 등록)를 먼저 하세요.")
        print("  ⚠️ 백업이 없는 상태입니다. 사고가 나면 되돌릴 수 없습니다.")
        return 1

    client = db.connect()

    # ---- 담기 ----
    buf = io.BytesIO()
    counts: dict[str, int] = {}
    # mtime=0 : 같은 내용이면 항상 같은 파일이 되도록 (지문 비교를 위해)
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
        for table, order_col in TABLES.items():
            try:
                rows = fetch_all(client, table, order_col)
            except Exception as exc:  # noqa: BLE001
                # 표가 아직 없을 수 있습니다 (archives 는 설정 전에는 없습니다)
                print(f"  ⚠️ {table}: 읽지 못했습니다 — {exc}")
                counts[table] = -1
                continue
            counts[table] = len(rows)
            for r in rows:
                line = json.dumps(
                    {"_table": table, **r}, ensure_ascii=False, sort_keys=True,
                    default=str,
                )
                gz.write((line + "\n").encode())
            print(f"  · {table:<14} {len(rows):>8,}줄")

    data = buf.getvalue()
    digest = hashlib.sha256(data).hexdigest()
    mb = round(len(data) / 1_000_000, 2)

    # 표 하나도 못 읽었으면 백업이라 할 수 없습니다
    if all(v <= 0 for v in counts.values()):
        print("\n❌ 아무 표도 읽지 못했습니다. 백업하지 않았습니다.")
        return 1

    print(f"\n  담은 크기 {mb}MB · 지문 {digest[:16]}…")

    if dry_run:
        print("\n[확인만 함] 올리지 않았습니다.")
        return 0

    key = f"backups/{stamp}.jsonl.gz"
    s3.put_object(Bucket=bucket, Key=key, Body=data,
                  ContentType="application/gzip")

    # ---- 올린 것이 온전한지 다시 내려받아 확인 ----
    # "올렸다" 는 말만 믿지 않습니다. 실제로 읽어서 지문을 맞춰 봅니다.
    got = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
    if hashlib.sha256(got).hexdigest() != digest:
        print("\n❌ 올린 파일이 원본과 다릅니다. 백업 실패로 처리합니다.")
        return 1
    print(f"  ✅ 올리고 확인까지 마쳤습니다: {key}")

    # ---- 오래된 백업 정리 ----
    listed = s3.list_objects_v2(Bucket=bucket, Prefix="backups/")
    keys = sorted((o["Key"] for o in listed.get("Contents", [])), reverse=True)
    old = keys[KEEP_BACKUPS:]
    for k in old:
        s3.delete_object(Bucket=bucket, Key=k)
    if old:
        print(f"  · 오래된 백업 {len(old)}개 정리 (최근 {KEEP_BACKUPS}개만 남깁니다)")

    print("\n" + "=" * 66)
    print(f"  ✅ 백업 완료 — 보관소에 {min(len(keys), KEEP_BACKUPS)}개 보관 중")
    print("     되돌리려면: GitHub → Actions → [백업에서 되돌리기]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
