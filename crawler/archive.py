"""
=============================================================================
 보관소로 옮기기 — 오래된 순위 기록을 Cloudflare R2 로
=============================================================================

 【왜 필요한가요?】
 Supabase 무료 용량은 500MB 입니다. 지금 수집량(하루 약 9만 권)이면
 한 달이면 찹니다. 차면 수집이 멈추고 사이트도 멈춥니다.

 그래서 오래된 날짜를 R2(무료 10GB)로 옮깁니다.
 데이터를 버리는 게 아니라 옮기는 것입니다.

 【데이터를 지우는 작업이므로 안전장치를 여러 겹 두었습니다】
  1. 최근 14일치는 무슨 설정을 해도 절대 안 건드립니다 (코드에 못박음)
  2. 올린 파일을 다시 내려받아 지문(sha256)이 같은지 확인합니다
  3. 줄 수가 정확히 일치하는지 확인합니다
  4. 위 확인이 전부 통과해야만 DB 에서 지웁니다
  5. --dry-run 으로 "무엇을 옮길지" 만 미리 볼 수 있습니다
  6. 접속 정보가 없으면 아무것도 하지 않고 안내만 합니다

 【실행】
 GitHub → Actions → [보관소로 옮기기] → Run workflow
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
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import config as cfg  # noqa: E402
from common import db  # noqa: E402

# 무슨 설정을 해도 이보다 최근 데이터는 건드리지 않습니다.
# 실수로 최근 순위를 날리는 것을 막는 마지막 방어선입니다.
ABSOLUTE_MIN_KEEP_DAYS = 14

# 옮길 표와, 그 표에서 읽을 열
TABLES = {
    "rankings": "snapshot_date,category_id,rank,store_book_id,sales_point",
    "book_meta": "store_book_id,snapshot_date,hashtags,events",
}


# 수집 기록은 보관소로 옮기지 않고 **그냥 지웁니다.**
# 순위 자료와 달리 다시 볼 일이 없는 운영 기록이기 때문입니다.
# (되살릴 수 없으므로 아무리 설정해도 이보다 짧게는 안 지웁니다)
ABSOLUTE_MIN_LOG_KEEP_DAYS = 30


def env(name: str) -> str:
    return os.environ.get(name, "").strip()


def prune_logs(client_db, log_keep_days: int) -> int:
    """
    오래된 수집 기록(crawl_logs)을 지웁니다.

    【왜 필요한가요? — 2026-08-09】
    분야가 208개라 하루 208줄씩 쌓입니다. 1년이면 7만 줄입니다.
    그런데 이 표는 보관소로도 안 빠지고 아무도 안 지우고 있었습니다.
    용량 계산도 이걸 '거의 안 늘어나는 것' 으로 세고 있어서, 예상 최대치가
    실제보다 계속 낮게 나왔습니다. 낮게 나오는 경고는 안 나오는 경고입니다.

    ⚠️ 순위 자료와 달리 **보관 파일을 만들지 않고 지웁니다.**
       되살릴 수 없으므로, 화면이 실제로 쓰는 기간(14일)보다 훨씬 넉넉한
       기본값(180일)을 두고, 그보다 짧게는 아무리 설정해도 안 지웁니다.
    """
    keep = max(ABSOLUTE_MIN_LOG_KEEP_DAYS, int(log_keep_days or 180))
    cutoff = (date.today() - timedelta(days=keep)).isoformat()

    try:
        # 몇 줄이 지워지는지 먼저 셉니다. "지웠습니다" 만 적고 실제로는
        # 0줄인 경우를 구분하기 위해서입니다.
        got = (
            client_db.table("crawl_logs")
            .select("id", count="exact", head=True)
            .lt("snapshot_date", cutoff)
            .execute()
        )
        n = got.count or 0
    except Exception as exc:  # noqa: BLE001
        print(f"  ⚠️ 수집 기록을 세지 못했습니다(정리 건너뜀): {exc}")
        return 0

    if n == 0:
        print(f"  수집 기록: {cutoff} 이전이 없습니다 (최근 {keep}일치 유지)")
        return 0

    try:
        client_db.table("crawl_logs").delete().lt("snapshot_date", cutoff).execute()
    except Exception as exc:  # noqa: BLE001
        # 정리에 실패했다고 보관 작업 전체를 실패로 만들지 않습니다.
        print(f"  ⚠️ 수집 기록을 지우지 못했습니다: {exc}")
        return 0

    print(f"  수집 기록: {cutoff} 이전 {n:,}줄 정리 (최근 {keep}일치 유지)")
    return n


def make_client():
    """
    R2 접속 준비. 접속 정보가 없으면 None 을 돌려줍니다.
    (설정 전에도 이 작업이 실패로 뜨지 않게 하기 위함입니다)
    """
    account = env("R2_ACCOUNT_ID")
    key_id = env("R2_ACCESS_KEY_ID")
    secret = env("R2_SECRET_ACCESS_KEY")
    bucket = env("R2_BUCKET")

    if not all([account, key_id, secret, bucket]):
        return None, None

    import boto3
    from botocore.config import Config

    client = boto3.client(
        "s3",
        endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        aws_access_key_id=key_id,
        aws_secret_access_key=secret,
        region_name="auto",
        config=Config(retries={"max_attempts": 5, "mode": "standard"}),
    )
    return client, bucket


def fetch_rows(client_db, table: str, cols: str, day: date) -> list[dict]:
    """그 날짜의 모든 줄을 나눠서 읽어옵니다 (1,000행 제한 회피)."""
    out: list[dict] = []
    step = 1000
    start = 0
    while True:
        res = (
            client_db.table(table)
            .select(cols)
            .eq("snapshot_date", day.isoformat())
            .order("snapshot_date")
            .range(start, start + step - 1)
            .execute()
        )
        rows = res.data or []
        out.extend(rows)
        if len(rows) < step:
            return out
        start += step


def pack(rows: list[dict]) -> tuple[bytes, str]:
    """줄들을 한 줄에 하나씩 적고 압축합니다. (내용, 지문) 을 돌려줍니다."""
    buf = io.BytesIO()
    # mtime=0 : 같은 내용이면 항상 같은 파일이 되도록 (지문 비교를 위해)
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
        for r in rows:
            gz.write(
                (json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n").encode()
            )
    data = buf.getvalue()
    return data, hashlib.sha256(data).hexdigest()


def already_archived(client_db) -> set[tuple[str, str]]:
    res = client_db.table("archives").select(
        "snapshot_date,table_name,deleted_from_db"
    ).execute()
    return {
        (r["snapshot_date"], r["table_name"])
        for r in (res.data or [])
        if r.get("deleted_from_db")
    }


# =============================================================================
#  GitHub 보관 — 두 단계로 나눠서 합니다
# =============================================================================
#  【왜 두 단계인가요? — 2026-08-08】
#  R2 는 올린 직후 바로 다시 읽어서 확인할 수 있습니다. 그런데 GitHub 은
#  올리기(upload-artifact)와 읽기(download-artifact)가 각각 별도 단계라
#  한 프로그램 안에서 확인할 수가 없습니다.
#
#  "올렸다" 는 말만 믿고 DB 에서 지우면, 실제로는 안 올라갔을 때
#  자료가 영영 사라집니다. 그래서 이렇게 나눴습니다.
#
#     1단계 export   파일로 뽑아내기만 함 (DB 는 손도 안 댐)
#     2단계 (GitHub) 올리기 → 다시 내려받기
#     3단계 commit   내려받은 파일을 검사하고, 통과한 것만 DB 에서 지움
#
#  즉 **실제로 내려받아서 확인된 것만** 지웁니다.
# =============================================================================


def archives_ready(client_db) -> str:
    """
    보관 기록표가 준비됐는지 먼저 확인합니다.

    【왜 필요한가요? — 2026-08-09】
    표가 없는 상태로 그냥 진행했더니 파이썬 오류 화면이 그대로 떴습니다.
    개발 지식이 없으면 그 화면만 봐서는 무엇을 해야 할지 알 수 없습니다.
    (예전 R2 방식은 접속 정보가 없으면 먼저 안내하고 멈췄는데, GitHub 방식은
     접속 정보라는 게 없어서 그 안내를 지나쳐 버렸습니다)

    돌려주는 값: "" 면 정상, 아니면 사람이 읽을 수 있는 안내문
    """
    try:
        client_db.table("archives").select(
            "snapshot_date,storage,expires_at,run_url,saved_at"
        ).limit(1).execute()
        return ""
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)

    # ⚠️ 칸이 없을 때를 '표가 없을 때' 보다 먼저 봅니다.
    #    "column archives.expires_at does not exist" 안에는 'archives' 와
    #    'does not exist' 가 둘 다 들어 있어서, 차례가 반대면 엉뚱한 안내가
    #    나갑니다. (2026-08-09 시험에서 실제로 걸렸습니다)
    if "column" in msg and (
        "storage" in msg or "expires_at" in msg
        or "run_url" in msg or "saved_at" in msg
    ):
        return (
            "보관 기록표에 칸이 몇 개 없습니다 "
            "(storage / expires_at / run_url / saved_at).\n"
            "  Supabase → SQL Editor → New query 에\n"
            "  db/archive_schema.sql 을 한 번 더 붙여넣고 Run 해주세요.\n"
            "  이미 있는 자료는 그대로 두고 칸만 더합니다."
        )
    if "archives" in msg and ("not find" in msg or "does not exist" in msg):
        return (
            "보관 기록표(archives)가 아직 없습니다.\n"
            "  Supabase → SQL Editor → New query 에\n"
            "  db/archive_schema.sql 전체를 붙여넣고 Run 해주세요. (1분)"
        )
    return f"보관 기록표를 읽지 못했습니다: {msg}"


def pick_dates(client_db, keep_days: int, max_dates: int) -> list[date]:
    """옮길 날짜를 고릅니다. (R2·GitHub 공통)"""
    cutoff = date.today() - timedelta(days=keep_days)
    done = already_archived(client_db)
    todo = [
        d for d in sorted(_distinct_dates(client_db))
        if d < cutoff and (d.isoformat(), "rankings") not in done
    ]
    return todo[:max_dates]


def do_export(client_db, todo: list[date], outdir: Path, key_tpl: str) -> int:
    """
    1단계 — 파일로 뽑아내기만 합니다. DB 는 하나도 안 바뀝니다.
    함께 만드는 manifest.json 이 3단계에서 '무엇을 확인할지' 의 기준이 됩니다.
    """
    outdir.mkdir(parents=True, exist_ok=True)
    manifest: list[dict] = []

    for day in todo:
        print(f"\n▶ {day}")
        for table, cols in TABLES.items():
            rows = fetch_rows(client_db, table, cols, day)
            if not rows:
                print(f"  · {table}: 0줄 (건너뜀)")
                continue

            data, digest = pack(rows)
            key = key_tpl.format(
                table=table, yyyy=f"{day.year:04d}",
                mm=f"{day.month:02d}", date=day.isoformat(),
            )
            path = outdir / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

            manifest.append({
                "snapshot_date": day.isoformat(),
                "table_name": table,
                "object_key": key,
                "row_count": len(rows),
                "byte_size": len(data),
                "sha256": digest,
            })
            print(f"  ✅ {table}: {len(rows):,}줄 → {len(data) / 1024:.0f}KB")

    (outdir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2)
    )
    total = sum(m["byte_size"] for m in manifest)
    print(f"\n  뽑아낸 파일 {len(manifest)}개 · 합계 {total / 1024 / 1024:.1f}MB")
    print("  ⚠️ 아직 DB 에서는 아무것도 지우지 않았습니다.")
    return 0


def do_commit(client_db, manifest_path: Path, verify_dir: Path,
              retention_days: int, run_url: str) -> int:
    """
    3단계 — 실제로 내려받은 파일을 검사하고, 통과한 것만 DB 에서 지웁니다.
    """
    manifest = json.loads(manifest_path.read_text())
    if not manifest:
        print("  옮길 것이 없습니다.")
        return 0

    expires = (date.today() + timedelta(days=retention_days)).isoformat()
    print(f"\n  파일이 사라지는 날: {expires} (약 {retention_days}일 뒤)")

    verified: dict[str, list[str]] = {}
    for m in manifest:
        path = verify_dir / m["object_key"]
        label = f"{m['snapshot_date']} {m['table_name']}"

        if not path.exists():
            print(f"  ❌ {label}: 내려받은 파일에 없습니다. 지우지 않습니다.")
            continue

        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != m["sha256"]:
            print(f"  ❌ {label}: 지문이 다릅니다. 지우지 않습니다.")
            continue

        back = gzip.decompress(data).decode().strip().split("\n")
        if len(back) != m["row_count"]:
            print(f"  ❌ {label}: 줄 수가 다릅니다 "
                  f"({m['row_count']:,} → {len(back):,}). 지우지 않습니다.")
            continue

        client_db.table("archives").upsert({
            "snapshot_date": m["snapshot_date"],
            "table_name": m["table_name"],
            "object_key": m["object_key"],
            "row_count": m["row_count"],
            "byte_size": m["byte_size"],
            "sha256": m["sha256"],
            "deleted_from_db": False,
            "storage": "github",
            "expires_at": expires,
            "run_url": run_url or None,
        }, on_conflict="snapshot_date,table_name").execute()

        verified.setdefault(m["snapshot_date"], []).append(m["table_name"])
        print(f"  ✅ {label}: 확인 완료")

    # ---- 그 날짜의 표가 '전부' 확인된 경우에만 지웁니다 ----
    want: dict[str, set[str]] = {}
    for m in manifest:
        want.setdefault(m["snapshot_date"], set()).add(m["table_name"])

    moved = 0
    for day, tables in want.items():
        if set(verified.get(day, [])) != tables:
            print(f"  ⚠️ {day}: 확인 안 된 표가 있어 지우지 않습니다.")
            continue
        for table in tables:
            client_db.table(table).delete().eq("snapshot_date", day).execute()
            client_db.table("archives").update({"deleted_from_db": True}).eq(
                "snapshot_date", day
            ).eq("table_name", table).execute()
        print(f"  🗑️ {day}: DB 에서 정리 완료")
        moved += 1

    print(f"\n  ✅ {moved}일치를 옮겼습니다.")
    if moved:
        print(f"\n  🚨 이 파일들은 {expires} 에 사라집니다.")
        print("     그 전에 내려받아 두세요. GitHub → Actions → 해당 실행 →")
        print("     맨 아래 Artifacts 에서 받을 수 있습니다.")
        print("     사이트 [수집 상태] 에서도 남은 날짜를 확인할 수 있습니다.")
    return 0


# =============================================================================
#  사라지기 전에 알려주기
# =============================================================================
#  【왜 필요한가요? — 2026-08-09】
#  GitHub 보관 기간의 최대값은 90일입니다. 사이트 [수집 상태] 화면에도
#  남은 날짜가 뜨지만, 그 화면을 매주 들여다보실 리가 없습니다.
#
#  그래서 이 작업은 **일부러 실패로 끝냅니다.** GitHub 은 작업이 실패하면
#  메일을 보내주기 때문입니다. 알림을 따로 만들 필요 없이,
#  실패 = 메일 이라는 이미 있는 길을 씁니다.
#
#  이미 내려받으신 뒤에도 계속 메일이 가면 안 되므로,
#  [보관 파일 내려받음 표시] 를 누르시면 그 파일은 조용해집니다.
# =============================================================================


def expiry_rows(client_db) -> list[dict]:
    """아직 내려받지 않은, 사라질 예정인 파일들 (가까운 순)."""
    res = (
        client_db.table("archives")
        .select("snapshot_date,table_name,expires_at,run_url,saved_at,storage")
        .eq("storage", "github")
        .not_.is_("expires_at", "null")
        .is_("saved_at", "null")
        .order("expires_at")
        .execute()
    )
    return res.data or []


def days_until(day: str, today: date | None = None) -> int:
    """그 날까지 며칠 남았는지. 이미 지났으면 음수."""
    return (date.fromisoformat(day) - (today or date.today())).days


def group_by_run(rows: list[dict]) -> list[dict]:
    """
    같은 실행에서 올린 파일은 한 덩어리로 묶습니다.
    한 번 실행에 14일치 × 2개 표 = 28줄이 나오는데,
    메일에 28줄을 그대로 적으면 무엇을 해야 할지 안 보입니다.
    """
    bucket: dict[tuple[str, str], dict] = {}
    for r in rows:
        key = (r.get("expires_at") or "", r.get("run_url") or "")
        g = bucket.setdefault(key, {
            "expires_at": r.get("expires_at"),
            "run_url": r.get("run_url"),
            "dates": set(),
            "files": 0,
        })
        g["dates"].add(r["snapshot_date"])
        g["files"] += 1
    out = list(bucket.values())
    out.sort(key=lambda g: g["expires_at"] or "")
    return out


def do_check_expiry(client_db, warn_days: int) -> int:
    """
    사라질 파일이 있으면 알려줍니다.
    돌려주는 값 1 = 작업 실패 = 대표님께 메일이 갑니다.
    """
    rows = expiry_rows(client_db)
    if not rows:
        print("\n✅ 사라질 예정인 보관 파일이 없습니다.")
        print("   (내려받아 두신 파일은 여기에 나오지 않습니다)")
        return 0

    groups = group_by_run(rows)
    urgent = [g for g in groups
              if g["expires_at"] and days_until(g["expires_at"]) <= warn_days]

    print(f"\n내려받지 않은 보관 파일 {len(groups)}묶음")
    for g in groups:
        left = days_until(g["expires_at"]) if g["expires_at"] else None
        mark = "🚨" if left is not None and left <= warn_days else "  "
        dates = sorted(g["dates"])
        span = dates[0] if len(dates) == 1 else f"{dates[0]} ~ {dates[-1]}"
        print(f"  {mark} {span} ({g['files']}개 파일) "
              f"· {g['expires_at']} 에 사라짐 · {left}일 남음")

    if not urgent:
        print(f"\n✅ {warn_days}일 안에 사라지는 것은 없습니다. 아직 여유 있습니다.")
        return 0

    print("\n" + "=" * 66)
    print(f"  🚨 {warn_days}일 안에 사라지는 보관 파일이 있습니다")
    print("=" * 66)
    print("\n  【하실 일 · 5분】")
    for i, g in enumerate(urgent, 1):
        dates = sorted(g["dates"])
        span = dates[0] if len(dates) == 1 else f"{dates[0]} ~ {dates[-1]}"
        print(f"\n  {i}) {span} — {g['expires_at']} 에 사라집니다")
        print(f"     {g['run_url'] or '(주소 기록 없음 — Actions 목록에서 찾으세요)'}")
        print("     → 그 화면 맨 아래 [Artifacts] 에서 내려받아")
        print("       PC 나 구글 드라이브에 두세요.")
    print("\n  다 받으셨으면 알림을 멈춰 주세요:")
    print("     GitHub → Actions → [보관 파일 만료 알림] → Run workflow →")
    print("     '내려받아 저장을 마쳤습니다' 를 true 로 두고 실행")
    print("\n  ※ 한 번 사라지면 되살릴 수 없습니다. 이 메일은 그래서 갑니다.")
    return 1


def do_mark_saved(client_db) -> int:
    """'내려받아 두었다' 고 표시합니다. 알림이 멈춥니다."""
    rows = expiry_rows(client_db)
    alive = [r for r in rows
             if r.get("expires_at") and days_until(r["expires_at"]) >= 0]

    if not alive:
        print("\n표시할 것이 없습니다. (알림 대상인 파일이 없습니다)")
        return 0

    now = now_iso()
    days = sorted({r["snapshot_date"] for r in alive})
    for r in alive:
        client_db.table("archives").update({"saved_at": now}).eq(
            "snapshot_date", r["snapshot_date"]
        ).eq("table_name", r["table_name"]).execute()

    print(f"\n✅ {len(alive)}개 파일({len(days)}일치)을 "
          f"'내려받음' 으로 표시했습니다.")
    print(f"   {days[0]} ~ {days[-1]}")
    print("   이제 이 파일들 때문에 메일이 오지 않습니다.")
    print("\n   ⚠️ 표시만 한 것입니다. 실제로 파일을 받아 두셨는지는")
    print("      프로그램이 확인할 수 없습니다. 꼭 받아 두세요.")
    return 0


def now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="무엇을 옮길지 보여주기만 하고 실제로는 안 옮김")
    ap.add_argument("--export", default="",
                    help="[GitHub 보관 1단계] 이 폴더로 파일을 뽑아냅니다")
    ap.add_argument("--commit", default="",
                    help="[GitHub 보관 3단계] 내려받은 이 폴더를 검사하고 정리합니다")
    ap.add_argument("--manifest", default="",
                    help="3단계에서 쓸 manifest.json 경로")
    ap.add_argument("--check-expiry", action="store_true",
                    help="곧 사라지는 보관 파일이 있으면 실패로 끝냅니다(=메일)")
    ap.add_argument("--mark-saved", action="store_true",
                    help="내려받아 두었다고 표시합니다 (알림이 멈춥니다)")
    args = ap.parse_args()
    dry_run = args.dry_run or env("DRY_RUN").lower() == "true"

    acfg = cfg.load("archive.yaml")

    # ---- 사라질 파일 알림 / 내려받음 표시 (옮기는 작업과는 별개입니다) ----
    if args.check_expiry or args.mark_saved:
        client_db = db.connect()
        problem = archives_ready(client_db)
        if problem:
            print(f"\nℹ️ 아직 준비가 안 됐습니다.\n\n  {problem}\n")
            print("  자세한 설명: docs/archive-setup.md")
            return 0
        if args.mark_saved:
            return do_mark_saved(client_db)
        return do_check_expiry(
            client_db, int(acfg.get("expiry_warn_days", 30))
        )

    keep_days = max(int(acfg.get("keep_days", 30)), ABSOLUTE_MIN_KEEP_DAYS)
    if keep_days != acfg.get("keep_days"):
        print(f"⚠️ keep_days 를 {acfg.get('keep_days')} → {keep_days} 로 올렸습니다.")
        print(f"   최근 {ABSOLUTE_MIN_KEEP_DAYS}일치는 어떤 설정으로도 안 지웁니다.")

    max_dates = int(acfg.get("max_dates_per_run", 14))
    warn_mb = int(acfg.get("warn_over_mb", 400))
    key_tpl = acfg.get("key_template",
                       "{table}/{yyyy}/{mm}/{table}_{date}.jsonl.gz")

    print("=" * 66)
    print("  보관소로 옮기기")
    print(f"  Supabase 에 남길 기간: 최근 {keep_days}일")
    print(f"  모드: {'확인만 (안 옮김)' if dry_run else '실제 이동'}")
    print("=" * 66)

    storage = str(acfg.get("storage", "r2")).strip().lower()
    retention = int(acfg.get("github_retention_days", 90))

    # ---- GitHub 보관 (두 단계) ----
    if storage == "github" or args.export or args.commit:
        client_db = db.connect()

        # 표가 없으면 오류 화면 대신 무엇을 해야 하는지 알려줍니다
        problem = archives_ready(client_db)
        if problem:
            print(f"\nℹ️ 아직 준비가 안 됐습니다.\n\n  {problem}\n")
            print("  자세한 설명: docs/archive-setup.md")
            print("  (준비될 때까지 자료는 그대로 쌓입니다. 지워지지 않습니다)")
            if args.export:
                out = Path(args.export)
                out.mkdir(parents=True, exist_ok=True)
                (out / "manifest.json").write_text("[]")
            return 0

        if args.commit:
            print("\n[3단계] 내려받은 파일을 검사하고 DB 를 정리합니다")
            # 순위 자료를 정리하는 김에 오래된 수집 기록도 함께 지웁니다.
            # (보관소로 옮기지 않고 그냥 지웁니다 — 운영 기록이라 다시 볼
            #  일이 없고, 화면은 최근 14일치만 씁니다)
            prune_logs(client_db, int(acfg.get("log_keep_days", 180)))
            return do_commit(
                client_db,
                Path(args.manifest or "out/manifest.json"),
                Path(args.commit),
                retention,
                env("RUN_URL"),
            )

        todo = pick_dates(client_db, keep_days, max_dates)
        if not todo:
            print(f"\n✅ 옮길 날짜가 없습니다. "
                  f"({date.today() - timedelta(days=keep_days)} 이전 자료 없음)")
            _report_size(client_db, warn_mb)
            # 뽑을 게 없어도 빈 manifest 를 남겨야 다음 단계가 안 헷갈립니다
            if args.export:
                out = Path(args.export)
                out.mkdir(parents=True, exist_ok=True)
                (out / "manifest.json").write_text("[]")
            return 0

        print(f"\n옮길 날짜 {len(todo)}일: {todo[0]} ~ {todo[-1]}")
        if dry_run or not args.export:
            for d in todo:
                print(f"  · {d}")
            print("\n[확인 모드] 실제로는 옮기지 않았습니다.")
            return 0

        print("\n[1단계] 파일로 뽑아냅니다 (DB 는 손대지 않습니다)")
        rc = do_export(client_db, todo, Path(args.export), key_tpl)
        _report_size(client_db, warn_mb)
        return rc

    # ---- R2 보관 (기존 방식) ----
    r2, bucket = make_client()
    if r2 is None:
        print("\nℹ️ 보관소 접속 정보가 없어 아무것도 하지 않았습니다.")
        print("   설정 방법: docs/archive-setup.md")
        print("   (GitHub Secrets 에 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID /")
        print("    R2_SECRET_ACCESS_KEY / R2_BUCKET 을 등록하면 켜집니다)")
        return 0

    client_db = db.connect()

    # ---- 옮길 날짜 고르기 ----
    cutoff = date.today() - timedelta(days=keep_days)
    all_dates = sorted(
        {d for d in _distinct_dates(client_db) if d < cutoff}
    )
    done = already_archived(client_db)
    todo = [d for d in all_dates if (d.isoformat(), "rankings") not in done]
    todo = todo[:max_dates]

    if not todo:
        print(f"\n✅ 옮길 날짜가 없습니다. ({cutoff} 이전 데이터 없음)")
        _report_size(client_db, warn_mb)
        return 0

    print(f"\n옮길 날짜 {len(todo)}일: {todo[0]} ~ {todo[-1]}")
    if dry_run:
        for d in todo:
            print(f"  · {d}")
        print("\n[확인 모드] 실제로는 옮기지 않았습니다.")
        return 0

    moved = 0
    for day in todo:
        print(f"\n▶ {day}")
        ok_all = True

        for table, cols in TABLES.items():
            rows = fetch_rows(client_db, table, cols, day)
            if not rows:
                print(f"  · {table}: 0줄 (건너뜀)")
                continue

            data, digest = pack(rows)
            key = key_tpl.format(
                table=table, yyyy=f"{day.year:04d}",
                mm=f"{day.month:02d}", date=day.isoformat(),
            )

            # ---- 올리기 ----
            r2.put_object(Bucket=bucket, Key=key, Body=data,
                          ContentType="application/gzip")

            # ---- 확인 1: 다시 내려받아 지문 비교 ----
            got = r2.get_object(Bucket=bucket, Key=key)["Body"].read()
            if hashlib.sha256(got).hexdigest() != digest:
                print(f"  ❌ {table}: 올린 파일이 손상됐습니다. 지우지 않습니다.")
                ok_all = False
                continue

            # ---- 확인 2: 줄 수 비교 ----
            back = gzip.decompress(got).decode().strip().split("\n")
            if len(back) != len(rows):
                print(f"  ❌ {table}: 줄 수가 다릅니다 "
                      f"({len(rows)} → {len(back)}). 지우지 않습니다.")
                ok_all = False
                continue

            client_db.table("archives").upsert({
                "snapshot_date": day.isoformat(),
                "table_name": table,
                "object_key": key,
                "row_count": len(rows),
                "byte_size": len(data),
                "sha256": digest,
                "deleted_from_db": False,
            }, on_conflict="snapshot_date,table_name").execute()

            print(f"  ✅ {table}: {len(rows):,}줄 → {len(data) / 1024:.0f}KB "
                  f"(확인 완료)")

        if not ok_all:
            print(f"  ⚠️ {day}: 확인에 실패한 표가 있어 DB 에서 지우지 않습니다.")
            continue

        # ---- 확인이 모두 끝난 뒤에만 지웁니다 ----
        for table in TABLES:
            client_db.table(table).delete().eq(
                "snapshot_date", day.isoformat()
            ).execute()
            client_db.table("archives").update({"deleted_from_db": True}).eq(
                "snapshot_date", day.isoformat()
            ).eq("table_name", table).execute()
        print(f"  🗑️ {day}: DB 에서 정리 완료 (보관소에는 그대로 있습니다)")
        moved += 1

    print(f"\n{'=' * 66}")
    print(f"  ✅ {moved}일치를 보관소로 옮겼습니다.")
    _report_size(client_db, warn_mb)
    return 0


def _distinct_dates(client_db) -> list[date]:
    """rankings 에 남아 있는 날짜 목록."""
    seen: set[str] = set()
    step = 1000
    start = 0
    while True:
        res = (
            client_db.table("rankings")
            .select("snapshot_date")
            .order("snapshot_date")
            .range(start, start + step - 1)
            .execute()
        )
        rows = res.data or []
        for r in rows:
            seen.add(r["snapshot_date"])
        if len(rows) < step:
            break
        start += step
    return [date.fromisoformat(s) for s in sorted(seen)]


def _report_size(client_db, warn_mb: int) -> None:
    """남은 데이터가 얼마나 되는지 알려줍니다."""
    try:
        res = client_db.table("rankings").select(
            "snapshot_date", count="exact", head=True
        ).execute()
        n = res.count or 0
    except Exception:  # noqa: BLE001
        return

    # 한 줄에 인덱스까지 약 176바이트로 잡습니다 (실측이 아니라 추정치)
    mb = n * 176 / 1024 / 1024
    print(f"\n  남은 순위 기록: {n:,}줄 (추정 {mb:.0f}MB)")
    if mb > warn_mb:
        print(f"  ⚠️ 추정 용량이 기준({warn_mb}MB)을 넘었습니다.")
        print(f"     config/archive.yaml 의 keep_days 를 줄이세요.")
    else:
        print(f"  ✅ 기준({warn_mb}MB) 이내입니다.")


if __name__ == "__main__":
    raise SystemExit(main())
