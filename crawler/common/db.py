"""
Supabase 저장 담당.

【반드시 지키는 두 가지】
1. 멱등성 — 같은 날 몇 번을 다시 돌려도 데이터가 중복되지 않습니다.
   rankings 는 (날짜, 카테고리) 단위로 지우고 다시 넣습니다.
2. 부분 실패 허용 — 한 카테고리가 실패해도 다른 카테고리 저장은 그대로 진행됩니다.

※ 비밀키는 환경변수로만 받습니다. 코드에 값이 없습니다.
"""

from __future__ import annotations

import os
from datetime import date
from typing import Any, Iterable

from supabase import Client, create_client


class DBError(RuntimeError):
    pass


def connect() -> Client:
    """환경변수에서 접속 정보를 읽어 Supabase 에 연결합니다."""
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        raise DBError(
            "SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다. "
            "GitHub 저장소 Settings → Secrets and variables → Actions 에서 등록하세요."
        )
    return create_client(url, key)


def _chunks(items: list, size: int = 500) -> Iterable[list]:
    """한 번에 너무 많이 보내지 않도록 나눕니다."""
    for i in range(0, len(items), size):
        yield items[i : i + size]


# -----------------------------------------------------------------------------
#  카테고리 동기화 — sources.yaml 의 내용을 DB 에 반영
# -----------------------------------------------------------------------------
def sync_category(client: Client, task) -> int:
    """
    카테고리 하나를 DB 에 등록하고 id 를 돌려줍니다.
    이미 있으면 정보만 갱신합니다 (중복 생성 안 함).
    """
    row = {
        "store_id": task.store_id,
        "code": task.code,
        "name": task.name,
        "kind": task.kind,
        "branch_code": task.branch_code,
        "branch_name": task.branch_name,
        "unified_code": task.unified_code,
        "url_template": task.url_template,
        "max_items": task.max_items,
        "page_size": task.page_size,
        "enabled": True,
    }
    res = (
        client.table("categories")
        .upsert(row, on_conflict="store_id,kind,branch_code,code")
        .execute()
    )
    if not res.data:
        raise DBError(f"카테고리 등록 실패: {task.label()}")
    return res.data[0]["id"]


# -----------------------------------------------------------------------------
#  서점별 도서 저장
# -----------------------------------------------------------------------------
def upsert_store_books(
    client: Client, store_id: int, rows: list[dict]
) -> dict[str, int]:
    """
    store_books 에 저장하고 {서점상품번호: DB내부id} 를 돌려줍니다.
    같은 상품번호가 이미 있으면 갱신만 하고 새로 만들지 않습니다.
    """
    if not rows:
        return {}

    key_to_id: dict[str, int] = {}
    for chunk in _chunks(rows):
        res = (
            client.table("store_books")
            .upsert(chunk, on_conflict="store_id,store_book_key")
            .execute()
        )
        for r in res.data or []:
            key_to_id[r["store_book_key"]] = r["id"]

    # upsert 응답에 빠진 게 있으면 조회해서 채웁니다
    missing = [r["store_book_key"] for r in rows if r["store_book_key"] not in key_to_id]
    for chunk in _chunks(missing, 200):
        res = (
            client.table("store_books")
            .select("id,store_book_key")
            .eq("store_id", store_id)
            .in_("store_book_key", chunk)
            .execute()
        )
        for r in res.data or []:
            key_to_id[r["store_book_key"]] = r["id"]

    return key_to_id


# -----------------------------------------------------------------------------
#  순위 스냅샷 저장 (멱등성 핵심)
# -----------------------------------------------------------------------------
def replace_rankings(
    client: Client, snapshot_date: date, category_id: int, rows: list[dict]
) -> int:
    """
    이 날짜·카테고리의 순위를 통째로 교체합니다.

    먼저 지우고 넣기 때문에:
      - 같은 날 재실행해도 중복이 안 생깁니다
      - 어제는 200위까지였는데 오늘 150위까지만 나와도, 남은 151~200위가
        옛날 데이터로 남아 있는 일이 없습니다
    """
    client.table("rankings").delete().eq(
        "snapshot_date", snapshot_date.isoformat()
    ).eq("category_id", category_id).execute()

    saved = 0
    for chunk in _chunks(rows):
        client.table("rankings").insert(chunk).execute()
        saved += len(chunk)
    return saved


def upsert_book_meta(client: Client, rows: list[dict]) -> None:
    """해시태그·이벤트 저장. 같은 날 같은 책은 덮어씁니다."""
    if not rows:
        return
    for chunk in _chunks(rows):
        client.table("book_meta").upsert(
            chunk, on_conflict="store_book_id,snapshot_date"
        ).execute()


# -----------------------------------------------------------------------------
#  실행 기록
# -----------------------------------------------------------------------------
def write_log(client: Client, row: dict[str, Any]) -> None:
    """crawl_logs 에 실행 결과를 남깁니다. 실패해도 수집 자체를 막지 않습니다."""
    try:
        client.table("crawl_logs").insert(row).execute()
    except Exception as exc:  # noqa: BLE001
        print(f"  ⚠️ 로그 기록 실패(수집에는 영향 없음): {exc}")


def median_recent_count(
    client: Client, category_id: int, snapshot_date: date, days: int = 7
) -> int | None:
    """
    최근 며칠간 이 카테고리에서 보통 몇 건이 수집됐는지 중앙값을 구합니다.
    자가 점검(평소의 절반 미만이면 실패 처리)에 씁니다.
    """
    try:
        res = (
            client.table("crawl_logs")
            .select("items_collected")
            .eq("category_id", category_id)
            .eq("status", "success")
            .lt("snapshot_date", snapshot_date.isoformat())
            .order("snapshot_date", desc=True)
            .limit(days)
            .execute()
        )
    except Exception:  # noqa: BLE001
        return None

    counts = sorted(r["items_collected"] for r in (res.data or []) if r["items_collected"])
    if not counts:
        return None
    return counts[len(counts) // 2]
