"""
=============================================================================
 백업에서 되돌리기 — 사고가 났을 때 쓰는 마지막 수단
=============================================================================

 【언제 쓰나요?】
 자료가 잘못 지워졌거나, 묶기 결과가 엉망이 됐거나, 데이터베이스에 문제가
 생겼을 때 씁니다. **평소에는 쓸 일이 없어야 정상입니다.**

 【유료(Pro) 와 무엇이 다른가요?】
 Pro 는 화면에서 날짜를 고르고 버튼 한 번이면 됩니다.
 무료에는 그 기능이 없어서, 이 작업이 그 자리를 대신합니다.
 결과는 같지만 **한 단계 더 거칩니다.**

 【안전장치】
  1. 기본은 '확인만' 입니다. 무엇이 들어갈지 먼저 보여줍니다.
  2. 실제로 넣으려면 confirm 을 true 로 둬야 합니다.
  3. 넣는 방식은 '덮어쓰기(upsert)' 입니다. 지금 있는 것을 지우지 않습니다.
     → 되돌린 뒤에 오늘 자료가 사라지는 일은 없습니다.
  4. 표를 넣는 차례를 지킵니다 (서점 → 분야 → 도서 → 서점별 도서 → …).
     차례가 틀리면 "없는 것을 가리킨다" 며 저장이 거부됩니다.
  5. 파일 지문을 확인합니다.

 【실행】
 GitHub → Actions → [백업에서 되돌리기] → Run workflow
=============================================================================
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import config as cfg  # noqa: E402
from common import db  # noqa: E402
from archive import make_client  # noqa: E402
from backup import TABLES  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", default="", help="되돌릴 백업 파일 (비우면 가장 최근 것)")
    ap.add_argument("--confirm", action="store_true", help="실제로 넣습니다")
    ap.add_argument("--from-dir", default="",
                    help="내려받은 백업 파일이 있는 폴더 (GitHub 방식)")
    args = ap.parse_args()

    key = args.key or os.environ.get("BACKUP_KEY", "").strip()
    confirm = args.confirm or os.environ.get("CONFIRM", "").lower() == "true"
    from_dir = args.from_dir or os.environ.get("FROM_DIR", "").strip()

    acfg = cfg.load("archive.yaml")
    storage = str(acfg.get("storage", "r2")).strip().lower()

    print("=" * 66)
    print("  백업에서 되돌리기")
    print(f"  가져올 곳: {'내려받은 파일' if (storage == 'github' or from_dir) else 'R2 보관소'}")
    print(f"  모드: {'실제로 넣음' if confirm else '확인만 (넣지 않음)'}")
    print("=" * 66)

    # ---- 백업 파일 가져오기 ----
    #
    #  🚨 【2026-09-01 — 여기도 R2 전용이었습니다】
    #    백업(backup.py)을 GitHub 파일 방식으로 바꿨으니, 되돌리기도 같은
    #    곳에서 가져와야 짝이 맞습니다. 한쪽만 고치면 백업은 쌓이는데
    #    정작 되돌릴 수가 없습니다.
    if storage == "github" or from_dir:
        base = Path(from_dir or "restore")
        found = sorted(base.rglob("*.jsonl.gz"))
        if not found:
            print(f"\n❌ {base} 안에 백업 파일(.jsonl.gz)이 없습니다.")
            print("   GitHub → Actions → [백업] 의 실행 하나를 골라,")
            print("   맨 아래 Artifacts 의 이름을 backup_run 칸에 넣어 주세요.")
            return 1
        if key:
            picked = [f for f in found if f.name == key or str(f).endswith(key)]
            if not picked:
                print(f"\n❌ 내려받은 파일 중에 {key} 가 없습니다.")
                print(f"   있는 것: {', '.join(f.name for f in found)}")
                return 1
            path = picked[0]
        else:
            path = found[-1]     # 이름이 시각이라 가장 뒤가 가장 최근입니다

        print(f"\n▶ 내려받은 백업 {len(found)}개")
        for f in found:
            print(f"    {'← 사용' if f == path else '     '} {f.name}")
        key = path.name
        data = path.read_bytes()
    else:
        s3, bucket = make_client()
        if not s3:
            print("\n보관소 접속 정보가 없습니다. 아무것도 하지 않았습니다.")
            return 1

        listed = s3.list_objects_v2(Bucket=bucket, Prefix="backups/")
        keys = sorted((o["Key"] for o in listed.get("Contents", [])), reverse=True)
        if not keys:
            print("\n보관소에 백업이 하나도 없습니다.")
            print("  GitHub → Actions → [백업] 을 먼저 한 번 실행하세요.")
            return 1

        print(f"\n▶ 보관소에 있는 백업 {len(keys)}개 (최근 것부터)")
        for k in keys[:10]:
            print(f"    {'← 사용' if k == (key or keys[0]) else '     '} {k}")

        key = key or keys[0]
        if key not in keys:
            print(f"\n❌ 그런 백업이 없습니다: {key}")
            return 1
        data = s3.get_object(Bucket=bucket, Key=key)["Body"].read()

    print(f"\n  파일 {round(len(data) / 1_000_000, 2)}MB · "
          f"지문 {hashlib.sha256(data).hexdigest()[:16]}…")

    by_table: dict[str, list[dict]] = {}
    for line in gzip.decompress(data).decode().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        table = row.pop("_table", None)
        if table:
            by_table.setdefault(table, []).append(row)

    print("\n▶ 백업에 담긴 내용")
    for table in TABLES:
        n = len(by_table.get(table, []))
        print(f"    {table:<14} {n:>8,}줄")

    if not confirm:
        print("\n[확인만 함] 실제로 넣으려면 confirm 을 true 로 두고 다시 실행하세요.")
        print("  ⚠️ 되돌리기는 지금 데이터를 덮어씁니다. 꼭 필요한 때만 하세요.")
        return 0

    # ---- 넣기 ----
    # TABLES 의 차례대로 넣습니다. 서로를 가리키는 관계가 있어서
    # 차례가 틀리면 저장이 거부됩니다. (예: 도서보다 서점별 도서를 먼저 넣으면 실패)
    client = db.connect()
    print("\n▶ 넣는 중... (차례를 지킵니다)")
    failed = 0
    for table in TABLES:
        rows = by_table.get(table, [])
        if not rows:
            continue
        try:
            for i in range(0, len(rows), 500):
                client.table(table).upsert(rows[i:i + 500]).execute()
            print(f"  ✅ {table:<14} {len(rows):>8,}줄")
        except Exception as exc:  # noqa: BLE001
            print(f"  ❌ {table:<14} 실패 — {exc}")
            failed += 1

    print("\n" + "=" * 66)
    if failed:
        print(f"  ❌ {failed}개 표가 실패했습니다. 위 메시지를 확인하세요.")
        return 1
    print("  ✅ 되돌리기 완료")
    print("     순위 기록은 별도입니다 — [보관소에서 불러오기] 로 날짜를 지정하세요.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
