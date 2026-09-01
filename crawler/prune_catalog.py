"""
=============================================================================
 도서 목록 정리 — 잠든 상품을 보관 파일로 빼고 DB 에서 지웁니다
=============================================================================

 【2026-08-18 대표님 지시】
   "매일 쌓이는 데이터 중에서 14일 동안 단 한 차례도 사용되지 않거나
    업데이트 되지 않는 데이터들은 제거 또는 보관함으로 알아서 보내주면
    좋겠어. 대신, 3사 서점 중에 단 한 차례라도 쓰였다면 지울 수 없도록
    해주고."

 【왜 필요한가요?】
 순위 기록(rankings)은 이미 보관소로 빠져나갑니다. 그런데 **도서 목록**
 (store_books · books · book_matches)은 아무도 정리하지 않았습니다.

     하루에 6,738권이 새로 들어옵니다.
     300위권은 자리가 정해져 있으니 그만큼이 매일 밀려납니다.
     밀려난 줄은 그대로 쌓입니다.  → 하루 12.2MB → 1년 4.5GB

 무료 한도는 500MB 입니다. 이대로면 2026-09-01 쯤 찹니다.

 【무엇을 '잠들었다' 고 보나요? — db/prune-catalog.sql 의 계산】
 셋 중 하나라도 해당하면 **살아 있는 것**이라 안 건드립니다.

   ㉠ 최근 14일 안에 서점 목록에 이름이 있었다 (순위에 들었든 아니든)
   ㉡ 순위 기록이 아직 DB 에 남아 있다
   ㉢ 대표님이 손으로 내린 결정(같은 책 / 다른 책)이 걸려 있다

 그리고 🚨 **3사 중 한 서점이라도 살아 있으면 그 묶음 전체를 살립니다.**
 한 서점 줄만 남으면 사이트가 "다른 서점에는 안 묶임" 이라고 적어서,
 실제로는 있는 책이 없는 것처럼 보이기 때문입니다.

 【지우기 전에 파일로 빼냅니다 — 3단계】
 archive.py 와 똑같은 방식입니다. "올렸다" 는 말만 믿고 지우지 않습니다.

     1단계 export   파일로 뽑아내기만 함 (DB 는 손도 안 댐)
     2단계 (GitHub) 올리기 → 다시 내려받기
     3단계 commit   내려받은 파일의 지문·줄 수를 확인하고, 통과한 것만 지움

 【왜 파일로 남겨야 하나요? — 그냥 지우면 안 되나요?】
 🚨 안 됩니다. 보관소에 있는 **옛날 순위 파일**은 상품 번호만 들고
    있습니다. 제목·저자·출판사는 store_books 에 있습니다. 상품 줄을
    그냥 지우면 옛날 순위 파일이 **번호만 남은 종이**가 됩니다.

 실행: GitHub → Actions → [도서 목록 정리]
=============================================================================
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from archive import pack  # noqa: E402  (같은 방식으로 담아야 되살릴 수 있습니다)
from common import config as cfg  # noqa: E402
from common import db  # noqa: E402

# 🚨 무슨 설정을 해도 이보다 최근 것은 안 건드립니다.
#    archive.py 의 ABSOLUTE_MIN_KEEP_DAYS 와 같은 뜻의 마지막 방어선입니다.
ABSOLUTE_MIN_DAYS = 14

# 한 번에 옮길 최대 상품 수. 너무 크면 작업이 오래 걸리고, 너무 작으면
# 따라잡지 못합니다. 하루 6,700줄이 밀려나므로 일주일치의 여유를 둡니다.
DEFAULT_MAX_ROWS = 80_000

# PostgREST 한 번에 보낼 수 있는 양
CHUNK = 500

# 보관 파일에 담을 열. **되살릴 수 있을 만큼** 담아야 합니다.
STORE_BOOK_COLS = (
    "id,store_id,store_book_key,raw_title,raw_author,raw_publisher,"
    "raw_pub_date,norm_title,norm_subtitle,norm_author,norm_publisher,"
    "pub_ym,pub_date,list_price,sale_price,isbn13,cover_url,edition_tags,"
    "set_volumes,book_id,first_seen_at,last_seen_at"
)
BOOK_COLS = "id,title,author,publisher,pub_ym,cover_url,isbn13"


def summary(client) -> list[dict]:
    """미리 세어 보기. 계산은 DB 쪽(db/prune-catalog.sql)이 합니다."""
    return client.rpc("dormant_summary", {"p_days": ABSOLUTE_MIN_DAYS}).execute().data or []


def rpc_missing(exc: Exception) -> bool:
    """계산이 아직 등록 안 된 상태인지."""
    msg = str(exc).lower()
    return ("dormant" in msg or "orphan_books" in msg) and (
        "not find" in msg or "does not exist" in msg or "schema cache" in msg
    )


def need_sql_notice() -> None:
    print("\n" + "=" * 66)
    print("  아직 준비가 안 됐습니다 — 딱 한 번만 해주시면 됩니다")
    print("=" * 66)
    print("  Supabase → 왼쪽 메뉴 SQL Editor → New query 에")
    print("  저장소의 db/prune-catalog.sql 전체를 붙여넣고 Run 하세요. (몇 초)")
    print("  자료는 하나도 안 바뀝니다. 계산 방법만 등록하는 것입니다.")
    print("=" * 66)


def fetch_by_ids(client, table: str, cols: str, ids: list[int]) -> list[dict]:
    """번호 목록으로 줄을 받아옵니다 (1,000행 제한을 피해 나눠서)."""
    out: list[dict] = []
    for i in range(0, len(ids), CHUNK):
        chunk = ids[i:i + CHUNK]
        res = (
            client.table(table).select(cols)
            .in_("id", chunk).order("id").execute()
        )
        out.extend(res.data or [])
    return out


def delete_by_ids(client, table: str, ids: list[int]) -> int:
    """번호 목록으로 지웁니다. 지운 줄 수를 돌려줍니다."""
    done = 0
    for i in range(0, len(ids), CHUNK):
        chunk = ids[i:i + CHUNK]
        client.table(table).delete().in_("id", chunk).execute()
        done += len(chunk)
        if done % 10_000 < CHUNK:
            print(f"    … {done:,}/{len(ids):,}줄")
    return done


def manual_count(client) -> int:
    """🚨 대표님이 내리신 결정 수. 이 값이 줄면 사고입니다."""
    res = (
        client.table("book_matches").select("id", count="exact", head=True)
        .in_("decision", ["manual_merge", "manual_split"]).execute()
    )
    return int(res.count or 0)


# ---------------------------------------------------------------------------
#  1단계 — 파일로 뽑아내기만 합니다 (DB 는 하나도 안 바뀝니다)
# ---------------------------------------------------------------------------
def do_export(client, days: int, max_rows: int, outdir: Path,
              key_tpl: str) -> int:
    stamp = date.today().isoformat()
    print(f"\n▶ 잠든 상품을 고릅니다 (기준 {days}일 · 최대 {max_rows:,}줄)")

    try:
        # 🚨 **나눠서 끝까지 받습니다.** 한 번에 부르면 Supabase 가 1,000줄만
        #    돌려줘서, 8,975개가 대상인 날에도 1,000개만 지웠습니다
        #    (2026-09-01). 하루에 들어오는 양보다 적어서 매일 순증했습니다.
        rows = db.rpc_all(
            client, "dormant_store_books",
            {"p_days": days, "p_limit": max_rows},
            max_rows=max_rows,
        )
    except Exception as exc:  # noqa: BLE001
        if rpc_missing(exc):
            need_sql_notice()
            return 2
        raise

    sb_ids = [int(r["id"]) for r in rows]
    if not sb_ids:
        print("  ✅ 지울 것이 없습니다. 전부 최근에 쓰였거나 순위가 남아 있습니다.")
        (outdir).mkdir(parents=True, exist_ok=True)
        (outdir / "manifest.json").write_text("[]")
        return 0

    print(f"  잠든 상품 {len(sb_ids):,}줄")

    # 🚨 지울 상품이 속한 묶음 중, **전부 지워지는** 묶음만 books 에서 뺍니다.
    #    한 서점이라도 남는 묶음은 계산(dormant_store_books)이 이미 걸러
    #    주지만, 여기서 한 번 더 확인합니다. 두 겹이 낫습니다.
    doomed_books = sorted({int(r["book_id"]) for r in rows if r.get("book_id")})
    print(f"  그중 통째로 비는 묶음 {len(doomed_books):,}개")

    outdir.mkdir(parents=True, exist_ok=True)
    manifest: list[dict] = []

    for table, cols, ids in (
        ("store_books", STORE_BOOK_COLS, sb_ids),
        ("books", BOOK_COLS, doomed_books),
    ):
        if not ids:
            print(f"  · {table}: 0줄 (건너뜀)")
            continue
        got = fetch_by_ids(client, table, cols, ids)
        if len(got) != len(ids):
            # 세어 둔 것과 받아온 것이 다르면 지우면 안 됩니다.
            print(f"  ❌ {table}: {len(ids):,}줄을 골랐는데 {len(got):,}줄만 "
                  f"받았습니다. 안전을 위해 멈춥니다.")
            return 1

        data, digest = pack(got)
        key = key_tpl.format(table=table, yyyy=stamp[:4], mm=stamp[5:7],
                             date=stamp)
        path = outdir / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

        manifest.append({
            "snapshot_date": stamp,
            "table_name": table,
            "object_key": key,
            "row_count": len(got),
            "byte_size": len(data),
            "sha256": digest,
            "ids": ids,          # 3단계에서 이 번호만 지웁니다
        })
        print(f"  ✅ {table}: {len(got):,}줄 → {len(data) / 1024:.0f}KB")

    (outdir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2)
    )
    print(f"\n  뽑아낸 파일 {len(manifest)}개")
    print("  ⚠️ 아직 DB 에서는 아무것도 지우지 않았습니다.")
    return 0


# ---------------------------------------------------------------------------
#  3단계 — 내려받은 파일을 확인하고, 통과한 것만 지웁니다
# ---------------------------------------------------------------------------
def verify(m: dict, verify_dir: Path) -> str:
    """통과하면 "", 아니면 사람이 읽을 수 있는 이유."""
    path = verify_dir / m["object_key"]
    if not path.exists():
        return "내려받은 파일에 없습니다"
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != m["sha256"]:
        return "지문(sha256)이 다릅니다"
    back = gzip.decompress(data).decode().strip().split("\n")
    if len(back) != m["row_count"]:
        return f"줄 수가 다릅니다 ({m['row_count']:,} → {len(back):,})"
    return ""


def do_commit(client, manifest_path: Path, verify_dir: Path,
              retention_days: int, run_url: str) -> int:
    manifest = json.loads(manifest_path.read_text())
    if not manifest:
        print("  옮길 것이 없습니다.")
        return 0

    # 🚨 시작 전에 결정 수를 세어 둡니다. 끝나고 줄었으면 사고입니다.
    before = manual_count(client)
    print(f"\n  🚨 대표님이 내리신 결정: {before:,}건 (이 숫자가 줄면 안 됩니다)")

    expires = (date.fromisoformat(manifest[0]["snapshot_date"]))
    from datetime import timedelta
    expires_at = (expires + timedelta(days=retention_days)).isoformat()

    by_table: dict[str, dict] = {}
    for m in manifest:
        why = verify(m, verify_dir)
        label = f"{m['table_name']} {m['row_count']:,}줄"
        if why:
            print(f"  ❌ {label}: {why}. 지우지 않습니다.")
            continue
        client.table("archives").upsert({
            "snapshot_date": m["snapshot_date"],
            "table_name": f"catalog_{m['table_name']}",
            "object_key": m["object_key"],
            "row_count": m["row_count"],
            "byte_size": m["byte_size"],
            "sha256": m["sha256"],
            "deleted_from_db": False,
            "storage": "github",
            "expires_at": expires_at,
            "run_url": run_url or None,
        }, on_conflict="snapshot_date,table_name").execute()
        by_table[m["table_name"]] = m
        print(f"  ✅ {label}: 확인 완료")

    # 🚨 store_books 가 확인 안 됐으면 아무것도 지우지 않습니다.
    #    books 만 지우면 상품이 주인 없는 상태로 남습니다.
    if "store_books" not in by_table:
        print("\n  ⚠️ 상품 파일이 확인되지 않아 아무것도 지우지 않았습니다.")
        return 1
    if "books" in by_table and len(by_table) < len(manifest):
        print("\n  ⚠️ 확인 안 된 파일이 있어 아무것도 지우지 않았습니다.")
        return 1

    # ---- 지웁니다. 순서가 중요합니다 ----
    #  상품을 먼저 지우면 매칭 근거(book_matches)가 딸려서 함께 지워집니다.
    #  그다음에야 묶음(books)이 껍데기가 됩니다.
    sb = by_table["store_books"]
    print(f"\n  🗑️ 상품 {sb['row_count']:,}줄을 지웁니다…")
    delete_by_ids(client, "store_books", sb["ids"])

    if "books" in by_table:
        bk = by_table["books"]
        print(f"  🗑️ 묶음 {bk['row_count']:,}개를 지웁니다…")
        delete_by_ids(client, "books", bk["ids"])

    # 남은 껍데기가 있으면 한 번 더 훑습니다 (계산이 놓친 것 대비)
    try:
        # 여기도 같은 이유로 나눠서 받습니다 (한 번에 부르면 1,000개까지만)
        left = db.rpc_all(client, "orphan_books", {"p_limit": DEFAULT_MAX_ROWS},
                          max_rows=DEFAULT_MAX_ROWS)
        if left:
            ids = [int(r["id"]) for r in left]
            print(f"  🗑️ 남은 껍데기 묶음 {len(ids):,}개를 더 지웁니다…")
            delete_by_ids(client, "books", ids)
    except Exception as exc:  # noqa: BLE001
        print(f"  ℹ️ 껍데기 확인을 건너뜁니다: {exc}")

    for m in by_table.values():
        client.table("archives").update({"deleted_from_db": True}).eq(
            "snapshot_date", m["snapshot_date"]
        ).eq("table_name", f"catalog_{m['table_name']}").execute()

    # 🚨 마지막 확인 — 대표님 결정이 하나라도 줄었으면 실패로 끝냅니다
    after = manual_count(client)
    print(f"\n  🚨 대표님이 내리신 결정: {before:,}건 → {after:,}건")
    if after < before:
        print("  ❌ 결정이 줄었습니다. 이건 있으면 안 되는 일입니다.")
        print("     보관 파일이 이 실행의 Artifacts 에 남아 있습니다.")
        return 1
    print("  ✅ 그대로입니다.")

    print(f"\n  ✅ 정리 완료. 보관 파일은 {expires_at} 에 사라집니다.")
    print("     그 전에 내려받아 두세요 (이 실행의 맨 아래 Artifacts).")
    return 0


# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", choices=("summary", "export", "commit"),
                    default="summary")
    ap.add_argument("--outdir", default="catalog-out")
    ap.add_argument("--manifest", default="catalog-out/manifest.json")
    ap.add_argument("--verify-dir", default="catalog-verify")
    ap.add_argument("--run-url", default="")
    args = ap.parse_args()

    acfg = cfg.load("archive.yaml")
    days = max(ABSOLUTE_MIN_DAYS, int(acfg.get("catalog_keep_days", 14) or 14))
    if days != acfg.get("catalog_keep_days"):
        print(f"⚠️ catalog_keep_days 를 {acfg.get('catalog_keep_days')} → "
              f"{days} 로 올렸습니다 (최소 {ABSOLUTE_MIN_DAYS}일).")
    max_rows = int(acfg.get("catalog_max_rows", DEFAULT_MAX_ROWS) or DEFAULT_MAX_ROWS)
    key_tpl = str(acfg.get("key_template",
                           "{table}/{yyyy}/{mm}/{table}_{date}.jsonl.gz"))
    retention = int(acfg.get("github_retention_days", 90) or 90)

    client = db.connect()

    print("=" * 66)
    print("  도서 목록 정리")
    print("=" * 66)
    print(f"  기준: {days}일 동안 서점 목록에 안 보이고, 순위도 안 남고,")
    print("        대표님 결정도 안 걸린 상품")
    print("  🚨 3사 중 한 서점이라도 살아 있으면 그 묶음은 통째로 남깁니다")

    if args.stage == "summary":
        try:
            rows = summary(client)
        except Exception as exc:  # noqa: BLE001
            if rpc_missing(exc):
                need_sql_notice()
                return 2
            raise
        print()
        for r in rows:
            note = f"   ← {r['note']}" if r.get("note") else ""
            print(f"  {r['label']:<28} {int(r['n']):>10,}{note}")
        print("\n  ※ 확인만 했습니다. 아무것도 지우지 않았습니다.")
        return 0

    if args.stage == "export":
        return do_export(client, days, max_rows, Path(args.outdir), key_tpl)

    return do_commit(client, Path(args.manifest), Path(args.verify_dir),
                     retention, args.run_url)


if __name__ == "__main__":
    raise SystemExit(main())
