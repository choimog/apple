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
from stores import aladin, kyobo, yes24  # noqa: E402
from stores.base import ParseError  # noqa: E402

# "이 페이지에는 도서가 없다" 를 서점마다 다른 모양으로 알려옵니다.
#   ParseError        : 도서 칸이 하나도 없는 페이지 (알라딘·예스24)
#   PageRenderTimeout : 도서 칸을 영영 안 그림 (교보. 브라우저로 읽기 때문)
# 앞 페이지를 이미 받았다면 둘 다 '목록의 끝' 이라는 뜻입니다.
END_OF_LIST_SIGNS: tuple[type[BaseException], ...] = (ParseError,)
try:
    from common.browser import PageRenderTimeout  # noqa: E402

    END_OF_LIST_SIGNS = (ParseError, PageRenderTimeout)
except Exception:  # playwright 가 없는 환경(시험 등)에서는 ParseError 만
    pass

# 한국시간 (서머타임 없음)
KST = timezone(timedelta(hours=9))

PARSERS = {
    "aladin": aladin,
    "yes24": yes24,
    "kyobo": kyobo,
}

# 이 서점만 '화면 없는 브라우저' 로 읽습니다.
#   교보 HTML 은 빈 껍데기여서 자바스크립트가 실행돼야 도서가 채워집니다.
#   느리고 무거우므로 꼭 필요한 서점에만 씁니다. (2026-08-07 대표 승인)
BROWSER_STORES = {"kyobo"}


def robots_allows(origin_url: str, target_url: str, ua: str, store_code: str) -> bool:
    """
    수집 전에 robots.txt 를 다시 확인합니다. (규칙이 언제든 바뀔 수 있으므로)
    금지면 False 를 돌려주고, 임의로 우회하지 않습니다.
    확인 자체가 실패하면 수집은 계속합니다(확인 실패 = 금지 아님).
    """
    try:
        with PoliteClient(user_agent=ua, delay_min=1.0, delay_max=1.5) as c:
            r = c.get(f"{origin_url}/robots.txt", allow_status=(403, 404),
                      check_block_markers=False, min_body_len=1)
        if r.status_code != 200:
            print(f"\n✅ {store_code}: robots.txt 없음(HTTP {r.status_code}) → 제한 없음")
            return True

        rules = parse_robots(r.text)
        allowed, why = rules.is_allowed(target_url, ua)
        if not allowed:
            print(f"\n🚫 {store_code}: robots.txt 가 수집을 금지합니다 — {why}")
            print("   수집을 중단합니다. 임의로 우회하지 않습니다.")
            return False
        print(f"\n✅ {store_code} robots.txt 확인: {why}")
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"\n⚠️ {store_code} robots.txt 확인 실패(수집은 계속): {exc}")
        return True


def kst_today():
    return datetime.now(KST).date()


def now_iso() -> str:
    """지금 시각.

    【왜 넣었나요? — 2026-08-08】
    crawl_logs 에 finished_at 을 아무도 안 채우고 있었습니다. 그래서 화면의
    '끝난 시각'·'걸린 시간' 이 사실은 '마지막 기록이 저장된 시각' 이었습니다.
    분야 하나가 끝날 때마다 실제 종료 시각을 남깁니다.
    """
    return datetime.now(KST).isoformat()


def build_store_book_row(row, store_id: int, words: dict | None = None) -> dict:
    """파서 결과를 store_books 표 형식으로 변환 (정규화 포함).

    words 는 config/matching.yaml 에서 읽은 단어 목록입니다.
    (에디션 단어 / 역할어 / 출판사 표기) — 없으면 코드의 기본값을 씁니다.
    """
    words = words or {}
    t = norm.normalize_title(
        row.raw_title,
        words.get("edition_words"),
        words.get("edition_canonical"),
    )
    return {
        "store_id": store_id,
        "store_book_key": row.store_book_key,
        "raw_title": row.raw_title,
        "raw_author": row.raw_author,
        "raw_publisher": row.raw_publisher,
        "raw_pub_date": row.raw_pub_date,
        "norm_title": t["core"],
        "norm_subtitle": t["subtitle"],
        "norm_author": norm.normalize_author(row.raw_author, words.get("role_words")),
        "norm_publisher": norm.normalize_publisher(
            row.raw_publisher, words.get("publisher_words")
        ),
        "pub_ym": row.pub_ym,
        "isbn13": row.isbn13,
        # 정가·판매가 (2026-08-11 추가)
        "list_price": row.list_price,
        "sale_price": row.sale_price,
        "cover_url": row.cover_url,
        "edition_tags": t["editions"],
        "set_volumes": t["set_volumes"],
        "last_seen_at": datetime.now(timezone.utc).isoformat(),
    }


def count_floor(baseline: int, want: int, reached_end: bool,
                first_day_floor: int = 10) -> tuple[int, int]:
    """
    '이만큼도 못 걷었으면 고장이다' 하는 기준을 정합니다.
    돌려주는 값: (비교 기준이 된 양, 최소 건수)

    【🚨 우리가 일부러 줄인 것을 '고장' 이라고 하면 안 됩니다 — 2026-08-11】
    대표님 결정으로 일간 1,000위 → 300위, 주간 → 500위로 줄였습니다.
    그런데 '평소' 는 아직 1,000권으로 남아 있어서, 제대로 300권을 걷어
    놓고도 40개 넘는 분야를 전부 실패로 몰았습니다.

        수집 건수가 비정상적으로 적습니다: 300권 (기준 499권, 평소 999권)
        서점 화면 개편 가능성 → config/selectors.yaml 확인 필요

    화면이 개편된 것도, 막힌 것도 아닌데 엉뚱한 곳을 가리켰습니다.
    그 말을 믿고 멀쩡한 설정을 고치면 진짜로 망가집니다.

    '평소' 는 과거 기록이고, max_items 는 **지금 우리가 받기로 한 양**
    입니다. 300권만 달라고 해 놓고 1,000권을 기대할 수는 없습니다.
    둘 중 작은 쪽을 기준으로 삼습니다.
    """
    base = min(baseline, want) if (baseline and want) else baseline
    ratio = 0.25 if reached_end else 0.5
    return base, (int(base * ratio) if base else first_day_floor)


def crawl_category(client_http: PoliteClient, task, parser, selectors,
                   role_priority: list[str] | None = None) -> tuple[list, bool]:
    """
    카테고리 하나를 페이지 단위로 수집합니다.

    돌려주는 값: (도서 목록, 목록의 끝까지 봤는가)
    '목록의 끝까지 봤는가' 가 중요합니다. 서점 목록이 437권에서 끝났는데
    우리가 1,000권을 기대하고 있으면, 437권은 '적게 걷힌' 게 아니라
    '그게 전부' 입니다. 이 둘을 구분하지 못하면 멀쩡한 자료를 버립니다.
    """
    role_priority = role_priority or norm.DEFAULT_ROLE_PRIORITY
    reached_end = False
    all_rows = []
    seen_keys: set[str] = set()
    seen_ranks: set[int] = set()

    for page in range(1, task.total_pages + 1):
        url = task.url_for(page)

        try:
            resp = client_http.get(url)
            rows = parser.parse_page(
                resp.text,
                selectors,
                role_priority=role_priority,
                page=page,
                page_size=task.page_size,
            )
        except END_OF_LIST_SIGNS as exc:
            # ---------------------------------------------------------------
            # 【목록의 끝을 '고장' 으로 착각하지 않기 — 2026-08-08 실제 사고】
            #
            # 서점 목록이 850권에서 끝나는데 우리가 1,000권까지 달라고 하면,
            # 서점은 "0권입니다" 라고 알려주지 않습니다. 대신
            #   알라딘·예스24 → 도서 칸이 하나도 없는 페이지를 줍니다
            #   교보          → 도서 칸을 영영 안 그려서 시간 초과가 납니다
            # 둘 다 '고장' 으로 처리했더니, 이미 잘 받아 둔 850권을 통째로
            # 버리고 그 분야가 실패로 기록됐습니다.
            # (알라딘 27개, 교보 14개가 이렇게 날아갔습니다)
            #
            # 구분하는 방법은 간단합니다:
            #   1페이지부터 안 된다  → 진짜 고장. 그대로 예외를 냅니다.
            #   앞 페이지는 받았는데 뒤가 안 된다 → 그냥 목록이 끝난 것입니다.
            # ---------------------------------------------------------------
            # ---------------------------------------------------------------
            # 🚨 【막힌 것을 '끝났다' 라고 하면 안 됩니다 — 2026-08-11】
            #
            # 위 규칙만 두면, 2페이지가 **막혀서** 비어 온 것도 '목록 끝' 으로
            # 칩니다. 예전에는 '평소' 가 1,000권이라 건수 점검이 잡아냈지만,
            # 일간을 300위로 줄인 지금은 다릅니다.
            #   교보 300권 = 2페이지. 2페이지가 막히면 200권만 받고
            #   '끝까지 봤다' 로 기록됩니다. 기준은 300×0.25 = 75권이라
            #   **그냥 통과합니다.** 200권만 조용히 저장되는 것입니다.
            #
            # diagnose_empty 가 이미 '막힌 것 같다' 를 가려내 줍니다.
            # 막힌 것이면 목록의 끝이 아니므로 그대로 실패시킵니다.
            # ---------------------------------------------------------------
            blocked = "막은 것 같습니다" in str(exc) or "너무 짧습니다" in str(exc)
            if page > 1 and all_rows and not blocked:
                print(f"    page {page}: 도서 없음 → 목록이 여기서 끝났습니다 "
                      f"(누적 {len(all_rows)}권 유지)")
                reached_end = True
                break
            raise

        # 마지막 페이지를 지나면 빈 목록이 오거나 같은 내용이 반복됩니다
        new_rows = [r for r in rows if r.store_book_key not in seen_keys]
        if not new_rows:
            print(f"    page {page}: 새 도서 없음 → 여기서 중단")
            reached_end = True
            break

        # -------------------------------------------------------------------
        # 【이미 나온 순위가 다시 나오면 그 페이지는 못 믿습니다 — 2026-08-08】
        #
        # 예스24는 목록이 짧은 분야에서 뒷 페이지를 요청하면, 앞 페이지에
        # 있던 순위 번호(15위 같은)를 단 '다른 책' 을 섞어서 돌려줍니다.
        # 15위가 두 권이 되니 저장 단계에서 데이터베이스가 거부했고,
        # 그 분야가 통째로 0권이 됐습니다. (10개 분야)
        #
        # 겹치는 게 몇 권이면 그 책만 빼면 되지만, 페이지의 상당수가 겹치면
        # 그 페이지 자체가 재탕입니다. 거기서 멈추고 앞 페이지까지만 씁니다.
        # -------------------------------------------------------------------
        collided = count_recycled(new_rows, seen_ranks)
        if is_recycled_page(new_rows, seen_ranks):
            print(f"    page {page}: {len(new_rows)}권 중 {collided}권이 "
                  f"이미 나온 순위입니다 → 앞 페이지 내용의 재탕으로 보고 중단 "
                  f"(누적 {len(all_rows)}권 유지)")
            reached_end = True
            break

        keep = []
        for r in new_rows:
            if r.rank in seen_ranks:
                continue  # 아래에서 몇 권을 뺐는지 한 줄로 알립니다
            seen_ranks.add(r.rank)
            seen_keys.add(r.store_book_key)
            keep.append(r)

        all_rows.extend(keep)
        dropped = len(new_rows) - len(keep)
        note = f" (순위 겹쳐서 {dropped}권 뺌)" if dropped else ""
        print(f"    page {page}: {len(keep)}권{note} (누적 {len(all_rows)})")

        if len(all_rows) >= task.max_items:
            break

    return dedupe_ranks(all_rows[: task.max_items], task.label()), reached_end


# 한 페이지에서 이 비율 이상이 '이미 나온 순위' 면, 그 페이지는 앞 내용의
# 재탕으로 보고 거기서 멈춥니다. (예스24가 목록 끝을 지나면 이렇게 나옵니다)
RECYCLED_PAGE_RATIO = 0.30

# 그래도 남은 순위 겹침이 이 비율을 넘으면, 그 분야 자료 자체를 못 믿는다고 봅니다.
MAX_DUPLICATE_RANK_RATIO = 0.10

# 한 서점에서 이 비율을 넘게 실패하면 실행 자체를 '실패' 로 표시합니다.
# GitHub 은 실패한 실행에만 메일을 보내므로, 이 값이 곧 '언제 연락을 받을지' 입니다.
#
#  · 너무 낮추면(0.01) 일시적인 통신 오류에도 매일 메일이 옵니다
#  · 너무 높이면(0.5) 절반이 망가져도 조용합니다
# 208개 기준 10% 는 약 20개입니다. 그 정도면 우연이 아니라 서점 화면이
# 바뀐 것으로 봐야 합니다.
FAIL_ALERT_RATIO = 0.10


def count_recycled(rows: list, seen_ranks: set[int]) -> int:
    """이 페이지의 도서 중 '이미 나온 순위' 를 달고 있는 권수."""
    return sum(1 for r in rows if r.rank in seen_ranks)


def is_recycled_page(rows: list, seen_ranks: set[int]) -> bool:
    """
    이 페이지가 앞 페이지 내용의 재탕인지 판단합니다.

    순위는 목록에서의 '자리' 입니다. 앞에서 이미 나온 자리 번호가
    이 페이지에 잔뜩 다시 나온다면, 서점이 목록의 끝을 지나 아무거나
    돌려주고 있다는 뜻입니다. 그런 페이지는 쓰지 않습니다.
    """
    if not rows:
        return False
    return count_recycled(rows, seen_ranks) >= len(rows) * RECYCLED_PAGE_RATIO


def dedupe_ranks(rows: list, label: str) -> list:
    """
    한 분야 안에서 같은 순위를 가진 도서가 둘 이상이면 정리합니다.

    【왜 필요한가요? — 2026-08-08 실제 사고】
    예스24 목록이 1,000권보다 짧은 분야에서, 뒤쪽 페이지를 요청하면
    앞 페이지에 있던 순위 번호를 단 '다른 책' 이 섞여 나왔습니다.
    한 분야에 15위가 두 권이 되니 저장 단계에서 데이터베이스가 거부했고
    (중복 키 오류), 그 분야 전체가 0권으로 실패했습니다.
    예스24 10개 분야가 이렇게 날아갔습니다.

    【어떻게 정리하나요】
    순위는 '목록에서의 자리' 입니다. 한 자리에 두 권이 있을 수 없습니다.
    먼저 나온 쪽(= 앞 페이지에서 온 쪽)이 맞다고 보고 뒤엣것을 버립니다.

    【조용히 버리지 않습니다】
    몇 권을 왜 버렸는지 로그에 남깁니다.
    버린 양이 10% 를 넘으면 그 분야 자료를 못 믿는다고 보고 실패 처리합니다.
    (서점이 정말로 화면을 개편했을 때를 놓치지 않기 위해서입니다)
    """
    seen_ranks: set[int] = set()
    kept, dropped = [], []
    for r in rows:
        if r.rank in seen_ranks:
            dropped.append(r)
            continue
        seen_ranks.add(r.rank)
        kept.append(r)

    if dropped:
        sample = ", ".join(str(r.rank) for r in dropped[:5])
        ratio = len(dropped) / max(1, len(rows))
        print(f"    ⚠️ 순위가 겹친 도서 {len(dropped)}권을 뺐습니다 "
              f"(겹친 순위 예: {sample}) — 앞 페이지 쪽을 남깁니다")
        if ratio > MAX_DUPLICATE_RANK_RATIO:
            raise RuntimeError(
                f"순위가 겹친 도서가 너무 많습니다: {len(dropped)}/{len(rows)}권 "
                f"({ratio:.0%}). 서점이 목록을 이상하게 돌려주고 있습니다. "
                f"({label}) → config/selectors.yaml 의 순위 위치를 확인하세요."
            )
    return kept


def process_task(client, client_http, task, parser, selectors, snapshot_date,
                 run_id: str, dry_run: bool, words: dict | None = None,
                 fingerprints: dict | None = None,
                 save_meta: bool = True) -> tuple[str, int]:
    """
    카테고리 하나를 수집 → 저장 → 로그까지.
    돌려주는 값: (상태, 수집건수)

    fingerprints 에는 "이 카테고리에서 어떤 책들이 나왔는지" 를 적어 둡니다.
    나중에 서로 다른 카테고리인데 결과가 똑같은 경우를 잡아내기 위해서입니다.
    """
    started = time.monotonic()
    print(f"\n▶ {task.label()} (최대 {task.max_items}권, {task.total_pages}페이지)")

    category_id = db.sync_category(client, task)
    role_priority = (words or {}).get("role_priority") or norm.DEFAULT_ROLE_PRIORITY
    rows, reached_end = crawl_category(
        client_http, task, parser, selectors, role_priority
    )
    collected = len(rows)

    if fingerprints is not None:
        fingerprints[task.label()] = frozenset(r.store_book_key for r in rows)

    # ---- 자가 점검: 평소의 절반 미만이면 실패로 기록 (요구사항 3-3) ----
    #
    # 【처음 수집하는 분야는 어떻게 하나요? — 2026-08-08 수정】
    # 비교할 '평소' 가 아직 없습니다. 예전에는 이때 '한 페이지 최소 권수'
    # (알라딘 40권)를 기준으로 썼는데, 목록 자체가 24권뿐인 분야
    # (알라딘 달력/기타)까지 실패로 몰았습니다. 짧은 목록은 잘못이 아닙니다.
    # 그래서 첫날에는 아주 낮은 기준만 두고, 둘째 날부터 '평소의 절반' 을 씁니다.
    FIRST_DAY_FLOOR = 10
    baseline = db.median_recent_count(client, category_id, snapshot_date)

    if collected == 0:
        raise RuntimeError("한 권도 수집하지 못했습니다.")

    # -----------------------------------------------------------------------
    # 【'목록이 끝났다' 와 '적게 걷혔다' 는 다릅니다 — 2026-08-08 수정】
    #
    # 알라딘 건강/취미 일간 목록은 437권에서 진짜로 끝납니다.
    # 그런데 '평소' 가 1,000권으로 남아 있어서(예전 버그가 뒷 페이지의
    # 재탕 내용까지 긁어모으던 시절의 숫자) 437권을 실패로 몰았습니다.
    # 멀쩡한 437권을 버린 것입니다.
    #
    # 이 점검의 목적은 "서점 화면이 개편돼 조용히 못 긁고 있는 것" 을
    # 잡는 것입니다. 마지막 페이지까지 정상적으로 읽고 목록의 끝을
    # 두 눈으로 확인했다면, 그 숫자가 곧 그 목록의 길이입니다.
    #
    # 그래서 기준을 둘로 나눕니다:
    #   목록 끝까지 봤다      → 25% 미만일 때만 실패 (그래도 급감은 신호)
    #   끝을 못 보고 멈췄다   → 예전대로 50% 미만이면 실패
    # -----------------------------------------------------------------------
    # -----------------------------------------------------------------------
    # 【🚨 우리가 일부러 줄인 것을 '고장' 이라고 하면 안 됩니다 — 2026-08-11】
    #
    # 대표님 결정으로 일간 1,000위 → 300위, 주간 → 500위로 줄였습니다.
    # 그런데 '평소' 는 아직 1,000권으로 남아 있어서, 제대로 300권을
    # 걷어 놓고도 전부 실패로 몰았습니다.
    #
    #     수집 건수가 비정상적으로 적습니다: 300권 (기준 499권, 평소 999권)
    #
    # 40개 넘는 분야가 이렇게 죽었습니다. 화면이 개편된 것도 아니고
    # 막힌 것도 아닌데 "selectors.yaml 을 확인하세요" 라고 엉뚱한 곳을
    # 가리켰습니다. 그 말을 믿고 멀쩡한 설정을 고치면 진짜로 망가집니다.
    #
    # '평소' 는 과거 기록이고, max_items 는 **지금 우리가 받기로 한 양**
    # 입니다. 우리가 300권만 달라고 해 놓고 1,000권을 기대할 수는 없습니다.
    # 둘 중 작은 쪽을 기준으로 삼습니다.
    # -----------------------------------------------------------------------
    want = task.max_items or 0
    base, threshold = count_floor(baseline, want, reached_end, FIRST_DAY_FLOOR)

    if threshold and collected < threshold:
        capped = bool(baseline and want and want < baseline)
        raise RuntimeError(
            f"수집 건수가 비정상적으로 적습니다: {collected}권 "
            f"(기준 {threshold}권, 평소 {baseline}권"
            + (f", 받기로 한 양 {want}권" if capped else "")
            + f"{', 목록 끝까지 확인함' if reached_end else ''}). "
            f"서점 화면 개편 가능성 → config/selectors.yaml 확인 필요."
        )

    # 실패까지는 아니어도, 평소의 절반 밑으로 떨어졌으면 알려는 드립니다.
    # (서점이 목록 길이를 줄였을 수 있습니다. 저장은 정상적으로 합니다)
    if base and collected < base * 0.5:
        print(f"  ℹ️ 평소({base}권)보다 적은 {collected}권입니다. "
              f"목록의 끝을 확인했으므로 그대로 저장합니다. "
              f"서점이 목록 길이를 줄였을 수 있습니다.")

    if dry_run:
        print(f"  [확인 모드] 저장하지 않음. {collected}권 수집됨")
        print(f"  예시: {rows[0].raw_title} / {rows[0].raw_author} / "
              f"{rows[0].raw_publisher} / SP={rows[0].sales_point}")
        return "success", collected

    # ---- 저장 ----
    sb_rows = [build_store_book_row(r, task.store_id, words) for r in rows]
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
        # 【2026-08-11】 save_book_meta 가 꺼져 있으면 모으지 않습니다.
        # 이 표는 사이트·리포트·매칭 어디서도 안 읽는데 24MB 를 쓰고
        # 있었습니다. 수집은 계속하되 저장만 안 합니다.
        if save_meta and (r.events or r.hashtags):
            meta_rows.append({
                "store_book_id": sb_id,
                "snapshot_date": snapshot_date.isoformat(),
                "hashtags": r.hashtags,
                "events": r.events,
            })

    saved = db.replace_rankings(client, snapshot_date, category_id, ranking_rows)
    if meta_rows:
        db.upsert_book_meta(client, meta_rows)
    extra = f", 부가정보 {len(meta_rows)}건" if save_meta else " (부가정보는 저장 안 함)"
    print(f"  ✅ 저장 완료: 순위 {saved}건{extra}")

    db.write_log(client, {
        "run_id": run_id,
        "store_id": task.store_id,
        "category_id": category_id,
        "snapshot_date": snapshot_date.isoformat(),
        "finished_at": now_iso(),
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

    # 표기 통일에 쓰는 단어 목록 (에디션/역할어/출판사 표기)
    # 없거나 읽기 실패하면 코드의 기본값으로 계속 진행합니다.
    try:
        words = cfg.load("matching.yaml")
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ config/matching.yaml 을 못 읽어 기본 단어 목록을 씁니다: {exc}")
        words = {}

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
    # 카테고리별로 "어떤 책들이 나왔는지" 를 기록해 둡니다.
    # 서로 다른 카테고리인데 결과가 똑같으면 주소가 잘못됐다는 신호입니다.
    fingerprints: dict[str, frozenset] = {}
    by_store: dict[str, list] = {}
    for t in ready:
        by_store.setdefault(t.store_code, []).append(t)

    for store_code, store_tasks in by_store.items():
        parser = PARSERS[store_code]
        selectors = selectors_all[store_code]
        origin = store_tasks[0].url_template.split("/", 3)[:3]
        origin_url = "/".join(origin)

        # ---- 설정에 있는 분야를 먼저 DB 에 등록합니다 ----
        # 수집이 실패한 분야도 '설정에 있는 분야' 이므로 여기서 등록해 둡니다.
        # 그래야 아래 정리 단계에서 실수로 꺼버리지 않습니다.
        #
        # 【robots 확인보다 먼저 합니다 — 2026-08-08】
        # 예전에는 robots 에 막히면 기록을 한 줄도 남기지 않고 넘어갔습니다.
        # 그러면 화면에서 '성공도 실패도 아닌 무(無)' 가 되어, 왜 비어 있는지
        # 아무도 알 수 없었습니다. 이제 막혀도 분야별로 이유를 남깁니다.
        live_ids: set[int] = set()
        cat_id_by_task: dict[int, int] = {}
        for task in store_tasks:
            try:
                cid = db.sync_category(client, task)
                live_ids.add(cid)
                cat_id_by_task[id(task)] = cid
            except Exception as exc:  # noqa: BLE001
                print(f"  ⚠️ 분야 등록 실패({task.label()}): {exc}")

        # ---- 설정에서 빠진 분야를 '수집 안 함' 으로 바꿉니다 ----
        # 지우지 않고 끄기만 합니다. 지난 순위 기록은 그대로 남습니다.
        if not dry_run:
            try:
                turned_off = db.disable_missing_categories(
                    client, store_tasks[0].store_id, live_ids
                )
                if turned_off:
                    print(f"\n🧹 설정에 없는 분야 {len(turned_off)}개를 껐습니다 "
                          f"(기록은 남아 있습니다): {', '.join(turned_off[:10])}")
            except Exception as exc:  # noqa: BLE001
                print(f"  ⚠️ 분야 정리 실패(수집에는 영향 없음): {exc}")

        # ---- robots.txt 재확인 (수집 방식과 무관하게 항상 보통 요청으로) ----
        if not robots_allows(origin_url, store_tasks[0].url_for(1), ua, store_code):
            for t in store_tasks:
                results.append((t.label(), "blocked_by_robots", 0))
                if not dry_run:
                    db.write_log(client, {
                        "run_id": run_id, "store_id": t.store_id,
                        "category_id": cat_id_by_task.get(id(t)),
                        "snapshot_date": snapshot_date.isoformat(),
                        "finished_at": now_iso(),
                        "status": "failed", "items_collected": 0,
                        "error_message":
                            "robots.txt 가 이 경로 수집을 허용하지 않습니다. "
                            "임의로 우회하지 않고 건너뛰었습니다.",
                    })
            continue

        # ---- 이 서점을 어떤 방식으로 읽을지 ----
        #  교보만 '화면 없는 브라우저'. 나머지는 보통 요청.
        #  (교보는 HTML 이 빈 껍데기라 자바스크립트를 실행해야 도서가 채워집니다)
        if store_code in BROWSER_STORES:
            from common.browser import PoliteBrowser  # 필요할 때만 불러옵니다

            print(f"\n🌐 {store_code}: 화면 없는 브라우저로 읽습니다 "
                  f"(이 서점만 해당. 다른 서점보다 느립니다)")
            fetcher = PoliteBrowser(
                delay_min=defaults.get("delay_min_sec", 1.5),
                delay_max=defaults.get("delay_max_sec", 2.5),
                wait_for=selectors.get("wait_for"),
            )
        else:
            fetcher = PoliteClient(
                user_agent=ua,
                delay_min=defaults.get("delay_min_sec", 1.0),
                delay_max=defaults.get("delay_max_sec", 2.0),
                max_retries=defaults.get("max_retries", 4),
                timeout=defaults.get("timeout_sec", 20),
                referer=origin_url,
            )

        with fetcher as http:
            for task in store_tasks:
                try:
                    status, n = process_task(
                        client, http, task, parser, selectors,
                        snapshot_date, run_id, dry_run, words, fingerprints,
                        bool(defaults.get("save_book_meta", True)),
                    )
                    results.append((task.label(), status, n))
                except BlockedError as exc:
                    print(f"  🚨 차단 의심: {exc}")
                    results.append((task.label(), "blocked", 0))
                    if not dry_run:
                        db.write_log(client, {
                            "run_id": run_id, "store_id": task.store_id,
                            "category_id": cat_id_by_task.get(id(task)),
                            "snapshot_date": snapshot_date.isoformat(),
                            "finished_at": now_iso(),
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
                            "category_id": cat_id_by_task.get(id(task)),
                            "snapshot_date": snapshot_date.isoformat(),
                            "finished_at": now_iso(),
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

    # ---- 자가 점검: 서로 다른 카테고리인데 결과가 완전히 같은 경우 ----
    #
    # 【왜 확인하나요?】
    # 예를 들어 '광화문점' 과 '강남점' 이 완전히 같은 목록을 돌려준다면,
    # 주소에 매장 번호가 제대로 안 들어갔다는 뜻입니다.
    # 이걸 못 잡으면 "매장별 순위" 라면서 실은 같은 데이터를 보여주게 됩니다.
    same: dict[frozenset, list[str]] = {}
    for label, keys in fingerprints.items():
        if keys:
            same.setdefault(keys, []).append(label)
    twins = [labels for labels in same.values() if len(labels) > 1]
    if twins:
        print("\n  ⚠️ 서로 다른 카테고리인데 수집 결과가 완전히 같습니다:")
        for labels in twins:
            print(f"     • {' = '.join(labels)}")
        print("     → config/sources.yaml 의 주소(특히 매장 코드)를 확인하세요.")
        print("     → 실제로 두 매장의 순위가 같을 수도 있으니 확인 후 판단하세요.")

    # ---- 실행을 성공으로 볼지 실패로 볼지 ----
    #
    # 【왜 고쳤나요? — 2026-08-08】
    # 예전에는 '전부 실패' 일 때만 실패로 표시했습니다. 그러면 91개 분야 중
    # 90개가 실패해도 1개만 성공하면 '성공' 으로 끝났습니다.
    # GitHub 은 실패한 실행에만 메일을 보내므로, 수집이 거의 다 망가져도
    # 아무도 모르게 됩니다. 실제로 위험한 건 '전멸' 보다 이 '조용한 붕괴' 입니다.
    #
    # 그래서 일정 비율을 넘게 실패하면 실행을 실패로 표시합니다.
    # 성공한 자료는 이미 저장돼 있습니다. 빨간불은 '자료를 버렸다' 가 아니라
    # '와서 봐 달라' 는 뜻입니다.
    failed = len(results) - ok
    if ok == 0:
        print("\n🚨 모든 분야가 실패했습니다.")
        return 1
    if failed and failed / len(results) > FAIL_ALERT_RATIO:
        print(f"\n🚨 {len(results)}개 중 {failed}개가 실패했습니다 "
              f"(기준 {FAIL_ALERT_RATIO:.0%} 초과).")
        print("   성공한 자료는 저장됐습니다. 서점 화면이 바뀌었는지 확인하세요.")
        print("   → 사이트의 [수집 상태] 에서 어느 분야가 왜 실패했는지 볼 수 있습니다.")
        return 1
    if failed:
        print(f"\n⚠️ 일부 실패 ({failed}개). 성공한 자료는 정상 저장됐습니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
