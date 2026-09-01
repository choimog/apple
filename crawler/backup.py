"""
=============================================================================
 백업 — 데이터베이스 전체를 통째로 저장합니다
=============================================================================

 【왜 필요한가요? — 2026-08-08 대표님 결정】
 Supabase 무료 요금제로 가기로 하셨습니다. 무료에는 **자동 백업이 없습니다.**
 유료(Pro)가 주는 것 중 용량은 보관소로 해결되지만, 백업은 안 됩니다.

 그래서 매주 데이터베이스 전체를 압축해 보관해 둡니다. 비용은 0원입니다.

 【어디에 두나요 — config/archive.yaml 의 storage 를 따릅니다】

   github  GitHub Actions 파일로 (카드 불필요 · 90일 보관)  ← 지금 이것
   r2      Cloudflare R2 로 (카드 필요 · 영구 보관)

 🚨 【2026-09-01 — 이 파일은 그동안 R2 전용이었습니다】
   설정은 storage: github 인데 이 파일만 R2 를 찾고 있었습니다. 그래서
   **백업이 한 번도 된 적이 없습니다.** 매주 월요일마다 이렇게 끝났습니다.

       보관소 접속 정보가 없습니다. 아무것도 하지 않았습니다.

   더 나빴던 것은 인수인계 문서에 "자동 백업 · 매주" 라고 적혀 있었다는
   점입니다. 대표님은 백업이 있는 줄 아셨습니다. 제 잘못입니다.

 【내려받아 두셔야 하나요? — 아니요】
 보관 파일(archive)과 다릅니다. 보관 파일은 DB 에서 이미 지운 것이라
 그 파일이 유일본이지만, 백업은 **원본이 DB 에 살아 있는 사본**입니다.
 사고가 났을 때 그때 GitHub 에서 받아 되돌리면 됩니다.
 (PC 에 하나쯤 두시면 더 안전한 정도입니다)

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

 【GitHub 방식은 왜 두 단계인가요?】
 올리기(upload-artifact)와 읽기(download-artifact)가 각각 별도 단계라
 한 프로그램 안에서 "제대로 올라갔는지" 확인할 수가 없습니다.
 그래서 archive.py 와 똑같이 나눴습니다.

   1단계 dump    파일로 담기만 함
   2단계 (GitHub) 올리기 → 다시 내려받기
   3단계 verify  내려받은 파일의 지문이 맞는지 확인

 "올렸다" 는 말만 믿지 않습니다.

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

from common import config as cfg  # noqa: E402
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


def do_verify(manifest_path: Path, verify_dir: Path) -> int:
    """
    3단계 — **실제로 내려받은** 파일이 담은 것과 같은지 확인합니다.

    "올렸다" 는 말만 믿지 않습니다. archive.py 와 같은 방식입니다.
    """
    try:
        man = json.loads(manifest_path.read_text())
    except Exception as exc:  # noqa: BLE001
        print(f"\n❌ 목록 파일을 읽지 못했습니다: {exc}")
        return 1

    if not man:
        print("\n❌ 목록이 비어 있습니다. 담긴 것이 없습니다.")
        return 1

    path = verify_dir / man["key"]
    if not path.exists():
        print(f"\n❌ 내려받은 파일에 {man['key']} 가 없습니다.")
        print("   올리기가 제대로 안 됐습니다. 백업이 없는 주입니다.")
        return 1

    got = hashlib.sha256(path.read_bytes()).hexdigest()
    if got != man["sha256"]:
        print("\n❌ 내려받은 파일이 담은 것과 다릅니다.")
        print(f"   담을 때 {man['sha256'][:16]}… · 받아 보니 {got[:16]}…")
        return 1

    size = path.stat().st_size
    if size != man["byte_size"]:
        print(f"\n❌ 크기가 다릅니다 ({size:,} ≠ {man['byte_size']:,}).")
        return 1

    print(f"\n  ✅ 확인 완료 — {man['key']} · "
          f"{man['byte_size'] / 1_000_000:.2f}MB · 지문 일치")
    print("     되돌리려면: GitHub → Actions → [백업에서 되돌리기]")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="담기만 하고 올리지 않음")
    ap.add_argument("--stage", choices=("dump", "verify"), default="dump",
                    help="GitHub 방식에서만 씁니다 (담기 / 확인)")
    ap.add_argument("--outdir", default="out", help="담은 파일을 둘 곳")
    ap.add_argument("--manifest", default="out/manifest.json")
    ap.add_argument("--verify-dir", default="verify")
    args = ap.parse_args()
    dry_run = args.dry_run or os.environ.get("DRY_RUN", "").lower() == "true"

    acfg = cfg.load("archive.yaml")
    storage = str(acfg.get("storage", "r2")).strip().lower()

    if args.stage == "verify":
        return do_verify(Path(args.manifest), Path(args.verify_dir))

    # 파일 이름에 쓸 시각. 실행 환경의 시계를 그대로 씁니다.
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")

    print("=" * 66)
    print(f"  백업 — {stamp}")
    print(f"  두는 곳: {'GitHub 파일' if storage == 'github' else 'R2 보관소'}")
    print(f"  모드: {'확인만 (올리지 않음)' if dry_run else '실제로 올림'}")
    print("=" * 66)

    s3 = bucket = None
    if storage != "github":
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

    # ---- GitHub 방식: 파일로 두기만 합니다. 올리는 것은 workflow 가 합니다 ----
    if storage == "github":
        outdir = Path(args.outdir)
        path = outdir / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        (outdir / "manifest.json").write_text(
            json.dumps({
                "key": key, "stamp": stamp, "sha256": digest,
                "byte_size": len(data), "rows": counts,
            }, ensure_ascii=False, indent=2)
        )
        print(f"  ✅ 담았습니다: {key} ({mb}MB)")
        print("     아직 확인 전입니다 — 올린 뒤 다시 내려받아 대조합니다.")
        #  ⚠️ 오래된 백업 정리는 하지 않습니다. GitHub 이 90일 뒤 알아서
        #     지웁니다. 우리가 지울 수 있는 것도 아니고, 지우려 들면
        #     '지우다 실패해서 백업이 실패로 뜨는' 쪽이 더 나쁩니다.
        return 0

    # ---- R2 방식 ----
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
