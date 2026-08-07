"""
=============================================================================
 매일 자동 수집 — 메인 실행 파일
=============================================================================

 매일 새벽 6시(한국시간)에 GitHub Actions 가 이 파일을 실행합니다.

 【지키는 원칙】
 - 목록 페이지만 수집. 도서 상세 페이지 진입 없음.
 - 한 카테고리가 실패해도 나머지는 계속 진행 (부분 실패 허용).
 - 같은 날 다시 돌려도 데이터 중복 없음 (멱등성).
 - 수집 건수가 평소의 절반 미만이면 성공으로 처리하지 않고 실패로 기록.
 - 표지 이미지는 저장하지 않고 서점 주소만 문자열로 보관.

 【수동 실행】
 Actions → [매일 수집 (daily crawl)] → Run workflow
   store   : 특정 서점만 (비우면 설정된 전체)
   dry_run : true 로 두면 DB 에 저장하지 않고 확인만
=============================================================================
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import config as cfg  # noqa: E402
from common import db  # noqa: E402
from common import normalize as norm  # noqa: E402
from common.http import BlockedError, PoliteClient  # noqa: E402
from common.robots import parse as parse_robots  # noqa: E402
from stores import aladin, yes24  # noqa: E402

# 한국시간 (서머타임 없음)
KST = timezone(timedelta(hours=9))

PARSERS = {
    "aladin": aladin,
    "yes24": yes24,
}


def kst_today():
    return datetime.now(KST).date()


def build_store_book_row(row, store_id: int) -> dict:
    """파서 결과를 store_books 표 형식으로 변환 (정규화 포함)."""
    t = norm.normalize_title(row.raw_title)
    return {
        "store_id": store_id,
        "store_book_key": row.store_book_key,
        "raw_title": row.raw_title,
        "raw_author": row.raw_author,
        "raw_publisher": row.raw_publisher,
        "raw_pub_date": row.raw_pub_date,
        "norm_title": t["core"],
        "norm_subtitle": t["subtitle"],
        "norm_author": norm.normalize_author(row.raw_author),
        "norm_publisher": norm.normalize_publisher(row.raw_publisher),
        "pub_ym": row.pub_ym,
        "isbn13": row.isbn13,
        "cover_url": row.cover_url,
        "edition_tags": t["editions"],
        "set_volumes": t["set_volumes"],
        "last_seen_at": datetime.now(timezone.utc).isoformat(),
    }


def crawl_category(client_http: PoliteClient, task, parser, selectors) -> list:
    """카테고리 하나를 페이지 단위로 수집합니다."""
    all_rows = []
    seen_keys: set[str] = set()

    for page in range(1, task.total_pages + 1):
        url = task.url_for(page)
        resp = client_http.get(url)

        rows = parser.parse_page(
            resp.text,
            selectors,
            role_priority=norm.DEFAULT_ROLE_PRIORITY,
            page=page,
            page_size=task.page_size,
        )

        # 마지막 페이지를 지나면 빈 목록이 오거나 같은 내용이 반복됩니다
        new_rows = [r for r in rows if r.store_book_key not in seen_keys]
        if not new_rows:
            print(f"    page {page}: 새 도서 없음 → 여기서 중단")
            break

        for r in new_rows:
            seen_keys.add(r.store_book_key)
        all_rows.extend(new_rows)
        print(f"    page {page}: {len(new_rows)}권 (누적 {len(all_rows)})")

        if len(all_rows) >= task.max_items:
            break

    return all_rows[: task.max_items]


def process_task(client, client_http, task, parser, selectors, snapshot_date,
                 run_id: str, dry_run: bool) -> tuple[str, int]:
    """
    카테고리 하나를 수집 → 저장 → 로그까지.
    돌려주는 값: (상태, 수집건수)
    """
    started = time.monotonic()
    print(f"\n▶ {task.label()} (최대 {task.max_items}권, {task.total_pages}페이지)")

    category_id = db.sync_category(client, task)
    rows = crawl_category(client_http, task, parser, selectors)
    collected = len(rows)

    # ---- 자가 점검: 평소의 절반 미만이면 실패로 기록 (요구사항 3-3) ----
    baseline = db.median_recent_count(client, category_id, snapshot_date)
    threshold = int(baseline * 0.5) if baseline else selectors.get(
        "min_items_per_page", 0
    )
    if collected == 0:
        raise RuntimeError("한 권도 수집하지 못했습니다.")
    if threshold and collected < threshold:
        raise RuntimeError(
            f"수집 건수가 비정상적으로 적습니다: {collected}권 "
            f"(기준 {threshold}권, 평소 {baseline}권). "
            f"서점 화면 개편 가능성 → config/selectors.yaml 확인 필요."
        )

    if dry_run:
        print(f"  [확인 모드] 저장하지 않음. {collected}권 수집됨")
        print(f"  예시: {rows[0].raw_title} / {rows[0].raw_author} / "
              f"{rows[0].raw_publisher} / SP={rows[0].sales_point}")
        return "success", collected

    # ---- 저장 ----
    sb_rows = [build_store_book_row(r, task.store_id) for r in rows]
    key_to_id = db.upsert_store_books(client, task.store_id, sb_rows)

    ranking_rows = []
    meta_rows = []
    for r in rows:
        sb_id = key_to_id.get(r.store_book_key)
        if sb_id is None:
            continue
        ranking_rows.append({
            "snapshot_date": snapshot_date.isoformat(),
            "category_id": category_id,
            "rank": r.rank,
            "store_book_id": sb_id,
            "sales_point": r.sales_point,
        })
        if r.events or r.hashtags:
            meta_rows.append({
                "store_book_id": sb_id,
                "snapshot_date": snapshot_date.isoformat(),
                "hashtags": r.hashtags,
                "events": r.events,
            })

    saved = db.replace_rankings(client, snapshot_date, category_id, ranking_rows)
    db.upsert_book_meta(client, meta_rows)
    print(f"  ✅ 저장 완료: 순위 {saved}건, 부가정보 {len(meta_rows)}건")

    db.write_log(client, {
        "run_id": run_id,
        "store_id": task.store_id,
        "category_id": category_id,
        "snapshot_date": snapshot_date.isoformat(),
        "status": "success",
        "items_collected": collected,
        "items_expected": task.max_items,
        "http_stats": {
            **client_http.stats.to_json(),
            "elapsed_sec": round(time.monotonic() - started, 1),
        },
    })
    return "success", collected


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--store", default="", help="특정 서점만 (aladin/yes24/kyobo)")
    ap.add_argument("--dry-run", action="store_true", help="DB에 저장하지 않고 확인만")
    args = ap.parse_args()

    dry_run = args.dry_run or os.environ.get("DRY_RUN", "").lower() == "true"
    only_store = (args.store or os.environ.get("ONLY_STORE", "")).strip() or None
    run_id = os.environ.get("GITHUB_RUN_ID", "local")
    snapshot_date = kst_today()

    print("=" * 66)
    print(f"  매일 수집 시작")
    print(f"  수집 기준일(한국시간): {snapshot_date}")
    print(f"  대상 서점: {only_store or '설정된 전체'}")
    print(f"  모드: {'확인만 (저장 안 함)' if dry_run else '실제 저장'}")
    print("=" * 66)

    sources = cfg.load("sources.yaml")
    selectors_all = cfg.load("selectors.yaml")
    defaults = sources.get("defaults", {})

    tasks = cfg.build_tasks(sources, only_store=only_store)
    # 파서가 아직 없는 서점은 건너뜁니다 (Phase 3 에서 추가)
    ready = [t for t in tasks if t.store_code in PARSERS]
    skipped = {t.store_code for t in tasks if t.store_code not in PARSERS}
    if skipped:
        print(f"\n※ 파서 미구현으로 건너뜀: {', '.join(sorted(skipped))} (Phase 3 예정)")

    if not ready:
        print("\n수집할 카테고리가 없습니다.")
        return 1

    client = db.connect()

    # ---- robots.txt 를 매 실행마다 다시 확인 (규칙이 바뀔 수 있으므로) ----
    ua = defaults.get("user_agent", "BestsellerTracker/1.0")

    results: list[tuple[str, str, int]] = []
    by_store: dict[str, list] = {}
    for t in ready:
        by_store.setdefault(t.store_code, []).append(t)

    for store_code, store_tasks in by_store.items():
        parser = PARSERS[store_code]
        selectors = selectors_all[store_code]
        origin = store_tasks[0].url_template.split("/", 3)[:3]
        origin_url = "/".join(origin)

        with PoliteClient(
            user_agent=ua,
            delay_min=defaults.get("delay_min_sec", 1.0),
            delay_max=defaults.get("delay_max_sec", 2.0),
            max_retries=defaults.get("max_retries", 4),
            timeout=defaults.get("timeout_sec", 20),
            referer=origin_url,
        ) as http:

            # robots.txt 재확인
            try:
                r = http.get(f"{origin_url}/robots.txt", allow_status=(404,),
                             check_block_markers=False, min_body_len=1)
                if r.status_code == 200:
                    rules = parse_robots(r.text)
                    allowed, why = rules.is_allowed(store_tasks[0].url_for(1), ua)
                    if not allowed:
                        print(f"\n🚫 {store_code}: robots.txt 가 수집을 금지합니다 — {why}")
                        print("   수집을 중단합니다. 임의로 우회하지 않습니다.")
                        for t in store_tasks:
                            results.append((t.label(), "blocked_by_robots", 0))
                        continue
                    print(f"\n✅ {store_code} robots.txt 확인: {why}")
            except Exception as exc:  # noqa: BLE001
                print(f"\n⚠️ {store_code} robots.txt 확인 실패(수집은 계속): {exc}")

            for task in store_tasks:
                try:
                    status, n = process_task(
                        client, http, task, parser, selectors,
                        snapshot_date, run_id, dry_run,
                    )
                    results.append((task.label(), status, n))
                except BlockedError as exc:
                    print(f"  🚨 차단 의심: {exc}")
                    results.append((task.label(), "blocked", 0))
                    if not dry_run:
                        db.write_log(client, {
                            "run_id": run_id, "store_id": task.store_id,
                            "snapshot_date": snapshot_date.isoformat(),
                            "status": "failed", "items_collected": 0,
                            "error_message": f"차단 의심: {exc}",
                            "http_stats": http.stats.to_json(),
                        })
                except Exception as exc:  # noqa: BLE001
                    print(f"  ❌ 실패: {type(exc).__name__}: {exc}")
                    traceback.print_exc()
                    results.append((task.label(), "failed", 0))
                    if not dry_run:
                        db.write_log(client, {
                            "run_id": run_id, "store_id": task.store_id,
                            "snapshot_date": snapshot_date.isoformat(),
                            "status": "failed", "items_collected": 0,
                            "error_message": f"{type(exc).__name__}: {exc}"[:900],
                            "http_stats": http.stats.to_json(),
                        })

    # ---- 요약 ----
    print("\n" + "=" * 66)
    print("  수집 결과 요약")
    print("=" * 66)
    ok = sum(1 for _, s, _ in results if s == "success")
    total_items = sum(n for _, _, n in results)
    for label, status, n in results:
        icon = "✅" if status == "success" else "❌"
        print(f"  {icon} {label:<34} {status:<20} {n}권")
    print(f"\n  성공 {ok}/{len(results)} 카테고리 · 총 {total_items}권")

    # 전부 실패했을 때만 실행 자체를 실패로 표시 (부분 실패는 허용)
    if ok == 0:
        print("\n🚨 모든 카테고리가 실패했습니다.")
        return 1
    if ok < len(results):
        print(f"\n⚠️ 일부 실패 ({len(results) - ok}개). 성공한 데이터는 정상 저장됐습니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
