"""
=============================================================================
 구글 시트로 내보내기 — 매일 수집·매칭이 끝난 뒤
=============================================================================

 【무엇을 하나요?】
 config/sheets.yaml 에 적은 순위표를 구글 시트에 **쌓습니다.**
 덮어쓰지 않고 날짜별로 아래에 붙이므로, 시트에서 바로 흐름을 볼 수 있습니다.

 【지키는 것】
  · 같은 날짜를 두 번 쓰지 않습니다 (다시 돌려도 안전)
  · 접속 정보가 없으면 아무 일도 안 하고 조용히 넘어갑니다
  · 설정에 적은 분야를 못 찾으면 **실패로 알립니다** (빈 탭을 만들지 않음)
  · 오래된 줄은 keep_days 만큼만 남기고 지웁니다 (시트 칸 한도 대비)

 【실행】
 매일 수집 작업이 끝난 뒤 자동으로 돕니다.
 손으로: GitHub → Actions → [구글 시트 내보내기]
=============================================================================
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import config as cfg  # noqa: E402

# 시트에 적는 칸 순서. 바꾸면 이미 쌓인 줄과 어긋나므로 함부로 바꾸지 마세요.
HEADER = [
    "날짜", "구분", "순위", "제목", "저자", "출판사", "출간월", "판매지수", "서점",
]

STORE_NAME = {1: "교보문고", 2: "예스24", 3: "알라딘"}
STORE_CODE_TO_ID = {"kyobo": 1, "yes24": 2, "aladin": 3}


def env(name: str) -> str:
    return os.environ.get(name, "").strip()


# -----------------------------------------------------------------------------
#  구글 접속
# -----------------------------------------------------------------------------
def open_sheet(sheet_id: str):
    """
    구글 시트를 엽니다. 접속 정보가 없으면 (None, 안내문) 을 돌려줍니다.

    【열쇠는 어디에 있나요?】
    GitHub Secrets 의 GOOGLE_SERVICE_ACCOUNT_JSON 하나뿐입니다.
    코드에는 값이 없습니다.
    """
    raw = env("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not raw or not sheet_id:
        return None, (
            "구글 접속 정보가 없어 아무것도 하지 않았습니다.\n"
            "  설정 방법: docs/sheets-setup.md\n"
            "  (GOOGLE_SERVICE_ACCOUNT_JSON 과 GOOGLE_SHEET_ID 를 등록하면 켜집니다)"
        )

    try:
        info = json.loads(raw)
    except json.JSONDecodeError:
        return None, (
            "GOOGLE_SERVICE_ACCOUNT_JSON 이 올바른 형식이 아닙니다.\n"
            "  구글에서 받은 .json 파일의 **내용 전체**를 그대로 붙여넣으셨는지\n"
            "  확인해 주세요. (파일 이름이 아니라 안에 든 내용입니다)"
        )

    import gspread
    from google.oauth2.service_account import Credentials

    creds = Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    client = gspread.authorize(creds)
    try:
        return client.open_by_key(sheet_id), ""
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        if "PERMISSION_DENIED" in msg or "403" in msg:
            return None, (
                "시트를 열 권한이 없습니다.\n"
                "  구글 시트를 열고 [공유] 를 눌러, 서비스 계정 이메일에\n"
                "  **편집자** 권한을 주셔야 합니다.\n"
                f"  서비스 계정 이메일: {info.get('client_email', '(모름)')}"
            )
        if "404" in msg or "not found" in msg.lower():
            return None, (
                f"그런 시트를 찾을 수 없습니다: {sheet_id}\n"
                "  GOOGLE_SHEET_ID 가 맞는지 확인해 주세요.\n"
                "  (시트 주소 .../d/여기가ID/edit)"
            )
        return None, f"시트를 열지 못했습니다: {msg}"


# -----------------------------------------------------------------------------
#  자료 뽑기
# -----------------------------------------------------------------------------
def latest_date(client_db) -> str | None:
    res = (
        client_db.table("rankings")
        .select("snapshot_date")
        .order("snapshot_date", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0]["snapshot_date"] if rows else None


def rows_combined(client_db, day: str, spec: dict) -> tuple[list[list], str]:
    """종합 순위 (2개 서점 이상에 오른 책)."""
    res = client_db.rpc(
        "combined_best",
        {
            "p_date": day,
            "p_period": spec.get("period", "daily"),
            "p_unified": spec.get("unified", "all"),
            "p_min_stores": int(spec.get("min_stores", 2)),
            "p_depth": 300,
            "p_limit": int(spec.get("top", 100)),
        },
    ).execute()
    data = res.data or []
    label = f"종합 {'주간' if spec.get('period') == 'weekly' else '일간'}"

    out = []
    for i, r in enumerate(data, 1):
        # 서점별 순위를 한 칸에 적습니다 (교보 3위 · 예스24 5위 …)
        ranks = r.get("ranks") or {}
        where = " · ".join(
            f"{STORE_NAME.get(int(k), k)} {v}위" for k, v in sorted(ranks.items())
        )
        # 판매지수도 서점마다 기준이 달라 하나로 합치지 않고 나란히 적습니다.
        # (교보는 판매지수를 공개하지 않으므로 그 서점은 아예 빠집니다)
        sales = r.get("sales") or {}
        sale_txt = " · ".join(
            f"{STORE_NAME.get(int(k), k)} {v}"
            for k, v in sorted(sales.items())
            if v is not None
        )
        out.append([
            day, label, i,
            r.get("title") or "", r.get("author") or "", r.get("publisher") or "",
            "",                       # 종합에는 출간월을 따로 안 담습니다
            sale_txt,
            where,
        ])
    return out, label


def rows_category(client_db, day: str, spec: dict) -> tuple[list[list], str]:
    """특정 서점의 특정 분야."""
    store_code = str(spec.get("store", "")).lower()
    store_id = STORE_CODE_TO_ID.get(store_code)
    if store_id is None:
        raise ValueError(f"모르는 서점입니다: {spec.get('store')}")

    kind = spec.get("category_kind", "online")
    name = spec.get("category", "")

    cat = (
        client_db.table("categories")
        .select("id,name,branch_name,kind")
        .eq("store_id", store_id)
        .eq("kind", kind)
        .eq("name", name)
        .eq("enabled", True)
        .limit(1)
        .execute()
    ).data or []
    if not cat:
        raise ValueError(
            f"그런 분야를 못 찾았습니다: {store_code} / {kind} / '{name}'\n"
            f"       config/sheets.yaml 의 이름이 config/sources.yaml 과 같은지 보세요."
        )
    c = cat[0]

    res = (
        client_db.table("rankings")
        .select(
            "rank,sales_point,"
            "store_books!inner(raw_title,raw_author,raw_publisher,pub_ym)"
        )
        .eq("category_id", c["id"])
        .eq("snapshot_date", day)
        .order("rank")
        .limit(int(spec.get("top", 100)))
        .execute()
    )
    label = f"{STORE_NAME[store_id]} {c.get('branch_name') or c['name']}" + (
        " 주간" if kind == "weekly" else ""
    )

    out = []
    for r in res.data or []:
        sb = r.get("store_books") or {}
        out.append([
            day, label, r.get("rank"),
            sb.get("raw_title") or "", sb.get("raw_author") or "",
            sb.get("raw_publisher") or "", sb.get("pub_ym") or "",
            # 판매지수가 없는 서점(교보)은 0 으로 채우지 않고 비워 둡니다
            r.get("sales_point") if r.get("sales_point") is not None else "",
            STORE_NAME[store_id],
        ])
    return out, label


# -----------------------------------------------------------------------------
#  시트에 쓰기
# -----------------------------------------------------------------------------
def write_tab(sheet, tab_name: str, rows: list[list], day: str,
              keep_days: int) -> str:
    """
    한 탭에 그 날짜 줄을 붙입니다.
    이미 그 날짜가 있으면 아무것도 하지 않습니다 (다시 돌려도 안전).
    """
    import gspread

    try:
        ws = sheet.worksheet(tab_name)
    except gspread.WorksheetNotFound:
        ws = sheet.add_worksheet(title=tab_name, rows=1000, cols=len(HEADER))
        ws.append_row(HEADER, value_input_option="RAW")

    existing = ws.col_values(1)          # 첫 칸(날짜)만 읽습니다 — 빠릅니다
    if not existing:
        ws.append_row(HEADER, value_input_option="RAW")
        existing = [HEADER[0]]

    if day in existing:
        return f"이미 {day} 가 있어 건너뜀"

    if not rows:
        # 자료가 없는데 빈 줄을 넣으면 "수집된 것처럼" 보입니다. 넣지 않습니다.
        return "그 날짜에 자료가 없어 아무것도 안 씀"

    ws.append_rows(rows, value_input_option="RAW")

    # ---- 오래된 줄 지우기 ----
    #
    # ⚠️ 한 줄씩 지우면 안 됩니다.
    #    180일치가 쌓인 뒤에는 매일 100줄씩 밀려나는데, 한 줄에 한 번씩
    #    구글에 부탁하면 하루 100번이 되어 사용 한도에 걸립니다.
    #    날짜순으로 쌓이므로 오래된 줄은 항상 **맨 위에 붙어 있습니다.**
    #    그래서 "2번째 줄부터 N번째 줄까지" 를 한 번에 지웁니다.
    cutoff = (date.fromisoformat(day) - timedelta(days=keep_days)).isoformat()
    last_old = 0
    for i, v in enumerate(existing, 1):
        if i == 1:
            continue          # 머리글
        if v and v < cutoff:
            last_old = i
        else:
            break             # 여기부터는 최근 자료입니다
    removed = 0
    if last_old >= 2:
        ws.delete_rows(2, last_old)
        removed = last_old - 1

    return f"{len(rows)}줄 추가" + (f" · 오래된 {removed}줄 정리" if removed else "")


def main() -> int:
    scfg = cfg.load("sheets.yaml")
    if not scfg.get("enabled", True):
        print("ℹ️ config/sheets.yaml 에서 꺼져 있습니다.")
        return 0

    sheet_id = str(scfg.get("spreadsheet_id") or "").strip() or env("GOOGLE_SHEET_ID")
    sheet, problem = open_sheet(sheet_id)

    print("=" * 66)
    print("  구글 시트 내보내기")
    print("=" * 66)

    if sheet is None:
        print(f"\nℹ️ {problem}\n")
        # 설정 전에는 실패로 만들지 않습니다. 매일 빨간 X 가 뜨면
        # 진짜 고장까지 같이 묻힙니다.
        return 0

    from common import db

    client_db = db.connect()
    day = latest_date(client_db)
    if not day:
        print("\n수집된 자료가 없습니다.")
        return 0

    print(f"\n기준 날짜: {day}")
    keep_days = int(scfg.get("keep_days", 180))
    failed = 0

    for spec in scfg.get("exports", []):
        tab = str(spec.get("tab") or "이름없음")
        try:
            if spec.get("kind") == "combined":
                rows, _ = rows_combined(client_db, day, spec)
            else:
                rows, _ = rows_category(client_db, day, spec)
            note = write_tab(sheet, tab, rows, day, keep_days)
            print(f"  ✅ {tab}: {note}")
        except Exception as exc:  # noqa: BLE001
            print(f"  ❌ {tab}: {exc}")
            failed += 1

    print()
    if failed:
        print(f"❌ {failed}개 탭이 실패했습니다. 위 안내를 보세요.")
        return 1
    print(f"✅ 시트 주소: https://docs.google.com/spreadsheets/d/{sheet_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
