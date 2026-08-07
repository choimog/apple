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


def _select_all(query_factory, step: int = 1000) -> list[dict]:
    """
    표 전체를 나눠서 읽어옵니다.

    【왜 필요한가요? — 2026-08-07 실제로 겪은 문제】
    Supabase 는 한 번에 1,000행까지만 돌려줍니다.
    이걸 모르고 그냥 읽으면 "표에 1,000행밖에 없다" 고 착각합니다.
    실제로 빈 껍데기 5,186종을 지워야 하는데 158종만 지운 적이 있습니다.

    query_factory 는 매번 새 조회를 만들어 주는 함수입니다.
    (한 번 쓴 조회를 재사용하면 조건이 겹쳐 쌓입니다)
    """
    out: list[dict] = []
    start = 0
    while True:
        rows = query_factory().range(start, start + step - 1).execute().data or []
        out.extend(rows)
        if len(rows) < step:
            return out
        start += step


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


# -----------------------------------------------------------------------------
#  매칭(같은 책 묶기)에 쓰는 조회/저장
# -----------------------------------------------------------------------------
def fetch_all_store_books(client: Client) -> list[dict]:
    """
    매칭에 필요한 열만 store_books 전체에서 읽어옵니다.
    (Supabase 는 한 번에 1,000행까지만 주므로 나눠서 받습니다)
    """
    # ※ store_book_key 를 빠뜨리면 나중에 연결할 때 그 칸이 비어서 저장이 실패합니다.
    #   (2026-08-07 실제로 겪음: null value in column "store_book_key")
    cols = ("id,store_id,store_book_key,raw_title,raw_author,raw_publisher,"
            "norm_title,norm_author,norm_publisher,pub_ym,isbn13,cover_url,"
            "edition_tags,set_volumes,book_id")
    return _select_all(lambda: client.table("store_books").select(cols).order("id"))


def fetch_manual_decisions(client: Client) -> dict[tuple[int, int], str]:
    """
    사람이 직접 내린 결정만 읽어옵니다.
    이 결정은 자동 로직이 절대 뒤집지 못합니다.
    돌려주는 값: {(작은id, 큰id): 'manual_merge' | 'manual_split'}
    """
    rows = _select_all(
        lambda: client.table("book_matches")
        .select("store_book_a,store_book_b,decision")
        .in_("decision", ["manual_merge", "manual_split"])
        .order("id")
    )
    return {
        (r["store_book_a"], r["store_book_b"]): r["decision"] for r in rows
    }


def save_matches(client: Client, rows: list[dict]) -> None:
    """매칭 근거를 저장합니다. 사람이 내린 결정은 건드리지 않습니다."""
    if not rows:
        return
    for chunk in _chunks(rows, 300):
        client.table("book_matches").upsert(
            chunk, on_conflict="store_book_a,store_book_b"
        ).execute()


def insert_books(client: Client, rows: list[dict]) -> list[int]:
    """
    도서 마스터를 한꺼번에 만듭니다. 넣은 순서대로 id 목록을 돌려줍니다.

    ※ 한 건씩 넣으면 도서 6,000종에 요청이 6,000번 나갑니다.
      실제로 그렇게 만들었다가 10분이 넘게 걸려서 한꺼번에 넣도록 바꿨습니다.
    """
    if not rows:
        return []
    ids: list[int] = []
    for chunk in _chunks(rows, 300):
        res = client.table("books").insert(chunk).execute()
        got = res.data or []
        if len(got) != len(chunk):
            raise DBError(
                f"도서 마스터 생성 실패: {len(chunk)}건 요청했는데 {len(got)}건만 돌아왔습니다."
            )
        ids.extend(r["id"] for r in got)
    return ids


def update_books(client: Client, rows: list[dict]) -> None:
    """
    이미 있는 도서 마스터를 한꺼번에 갱신합니다.
    rows 에는 반드시 id 가 들어 있어야 합니다.
    """
    if not rows:
        return
    for chunk in _chunks(rows, 300):
        client.table("books").upsert(chunk, on_conflict="id").execute()


def link_store_books_bulk(client: Client, rows: list[dict]) -> None:
    """
    "이 서점 도서는 이 도서 마스터에 속한다" 를 한꺼번에 표시합니다.

    rows 의 각 항목에는 id / store_id / store_book_key / raw_title / book_id 가
    들어 있어야 합니다. (id 로 덮어쓰지만, 새로 넣는 경우를 대비해
    비어 있으면 안 되는 칸들을 함께 보냅니다)

    ※ 도서마다 따로 표시하면 요청이 수천 번 나갑니다. 그래서 묶어서 보냅니다.
    """
    if not rows:
        return
    for chunk in _chunks(rows, 500):
        client.table("store_books").upsert(chunk, on_conflict="id").execute()


def delete_orphan_books(client: Client, keep_ids: set[int]) -> int:
    """
    아무 서점 도서와도 연결되지 않은 도서 마스터를 지웁니다.
    (매칭을 다시 계산하면 예전에 만들어진 빈 껍데기가 남을 수 있습니다)
    """
    # ※ 그냥 select 하면 1,000행만 옵니다. 나눠서 전부 읽어야 합니다.
    rows = _select_all(lambda: client.table("books").select("id").order("id"))
    all_ids = {r["id"] for r in rows}
    orphans = sorted(all_ids - keep_ids)
    for chunk in _chunks(orphans, 200):
        client.table("books").delete().in_("id", chunk).execute()
    return len(orphans)


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
