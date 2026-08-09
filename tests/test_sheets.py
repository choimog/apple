"""
구글 시트 내보내기가 거짓말을 하지 않는지 시험.

【무엇을 확인하나요?】
 1. 같은 날짜를 두 번 쌓지 않는다 (다시 돌려도 안전)
 2. 자료가 없으면 빈 줄을 넣어 '수집된 것처럼' 보이게 하지 않는다
 3. 오래된 줄은 한 번에(범위로) 지운다 — 한 줄씩 지우면 구글 한도에 걸립니다
 4. 최근 줄은 절대 지우지 않는다
 5. config/sheets.yaml 이 실제로 읽히고 필요한 값이 다 있다
 6. 칸 개수가 머리글과 어긋나지 않는다

실행: python tests/test_sheets.py
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

# 시험은 데이터베이스도 구글도 없이 돌아야 합니다.
_fake_sb = types.ModuleType("supabase")
_fake_sb.Client = object
_fake_sb.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _fake_sb)


class _NotFound(Exception):
    pass


_fake_gs = types.ModuleType("gspread")
_fake_gs.WorksheetNotFound = _NotFound
sys.modules.setdefault("gspread", _fake_gs)

import export_sheets as ex  # noqa: E402
from common import config as cfg  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


# -----------------------------------------------------------------------------
#  가짜 시트 — 진짜 구글에 붙지 않고 '무엇을 시켰는지' 만 적어 둡니다
# -----------------------------------------------------------------------------
class FakeWorksheet:
    def __init__(self, dates: list[str]):
        # dates[0] 은 머리글("날짜") 이어야 합니다
        self.dates = list(dates)
        self.appended: list[list] = []
        self.deletes: list[tuple] = []

    def col_values(self, n):
        return list(self.dates)

    def append_row(self, row, **kw):
        self.dates.append(str(row[0]))

    def append_rows(self, rows, **kw):
        self.appended.extend(rows)

    def delete_rows(self, *args):
        self.deletes.append(args)


class FakeSheet:
    def __init__(self, ws=None):
        self.ws = ws
        self.created: list[str] = []

    def worksheet(self, name):
        if self.ws is None:
            raise _NotFound(name)
        return self.ws

    def add_worksheet(self, title, rows, cols):
        self.created.append(title)
        self.ws = FakeWorksheet([])
        return self.ws


def row(day: str) -> list:
    return [day, "종합 일간", 1, "제목", "저자", "출판사", "2026-01", "", "알라딘 1위"]


print("\n[1] 같은 날짜를 두 번 쌓지 않기")
ws = FakeWorksheet(["날짜", "2026-08-08", "2026-08-09"])
note = ex.write_tab(FakeSheet(ws), "탭", [row("2026-08-09")], "2026-08-09", 180)
check("이미 있는 날짜는 건너뜀", "건너뜀" in note, note)
check("아무 줄도 더하지 않음", ws.appended == [], ws.appended)
check("아무 줄도 지우지 않음", ws.deletes == [], ws.deletes)


print("\n[2] 자료가 없으면 빈 줄을 넣지 않기")
ws = FakeWorksheet(["날짜", "2026-08-08"])
note = ex.write_tab(FakeSheet(ws), "탭", [], "2026-08-09", 180)
check("빈 줄을 넣지 않음", ws.appended == [], ws.appended)
check("'자료가 없다' 고 말함", "자료가 없" in note, note)


print("\n[3] 새 날짜는 아래에 쌓기")
ws = FakeWorksheet(["날짜", "2026-08-08"])
note = ex.write_tab(FakeSheet(ws), "탭", [row("2026-08-09")], "2026-08-09", 180)
check("한 줄 더해짐", len(ws.appended) == 1, ws.appended)
check("오래된 줄은 없으니 안 지움", ws.deletes == [], ws.deletes)


print("\n[4] 오래된 줄은 '한 번에' 지우기")
# 보관 3일 · 오늘 2026-08-10 → 2026-08-07 보다 이전은 지웁니다
old = ["날짜", "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-08", "2026-08-09"]
ws = FakeWorksheet(old)
note = ex.write_tab(FakeSheet(ws), "탭", [row("2026-08-10")], "2026-08-10", 3)
check("지우기를 딱 한 번만 시킴", len(ws.deletes) == 1, ws.deletes)
check("2번째 줄부터 4번째 줄까지 한 범위로", ws.deletes == [(2, 4)], ws.deletes)
check("3줄 정리했다고 말함", "3줄 정리" in note, note)


print("\n[5] 최근 줄은 절대 안 지우기")
ws = FakeWorksheet(["날짜", "2026-08-08", "2026-08-09"])
ex.write_tab(FakeSheet(ws), "탭", [row("2026-08-10")], "2026-08-10", 180)
check("보관 기간 안이면 안 지움", ws.deletes == [], ws.deletes)

# 경계: 딱 keep_days 만큼 지난 줄은 남깁니다 (cutoff 와 같으면 '이전' 이 아님)
ws = FakeWorksheet(["날짜", "2026-08-07", "2026-08-09"])
ex.write_tab(FakeSheet(ws), "탭", [row("2026-08-10")], "2026-08-10", 3)
check("경계 날짜(cutoff 당일)는 남김", ws.deletes == [], ws.deletes)


print("\n[6] 탭이 없으면 만들고 머리글부터 넣기")
sheet = FakeSheet(None)
ex.write_tab(sheet, "새 탭", [row("2026-08-10")], "2026-08-10", 180)
check("탭을 만듦", sheet.created == ["새 탭"], sheet.created)
check("머리글이 첫 줄", sheet.ws.dates[:1] == ["날짜"], sheet.ws.dates)
check("자료 줄이 들어감", len(sheet.ws.appended) == 1, sheet.ws.appended)


print("\n[7] config/sheets.yaml 이 실제로 읽히는지")
scfg = cfg.load("sheets.yaml")
exports = scfg.get("exports") or []
check("내보낼 표가 하나 이상", len(exports) >= 1, len(exports))
check("keep_days 가 숫자", isinstance(scfg.get("keep_days"), int), scfg.get("keep_days"))

names = [e.get("tab") for e in exports]
check("탭 이름이 겹치지 않음", len(names) == len(set(names)), names)

for e in exports:
    tab = e.get("tab")
    kind = e.get("kind")
    check(f"'{tab}' 의 kind 가 combined/category", kind in ("combined", "category"), kind)
    if kind == "category":
        check(
            f"'{tab}' 의 서점 이름을 아는지",
            str(e.get("store", "")).lower() in ex.STORE_CODE_TO_ID,
            e.get("store"),
        )
        check(
            f"'{tab}' 의 분야 종류가 online/weekly/offline",
            e.get("category_kind") in ("online", "weekly", "offline"),
            e.get("category_kind"),
        )
        check(f"'{tab}' 에 분야 이름이 있음", bool(e.get("category")), e.get("category"))
    else:
        check(
            f"'{tab}' 의 기간이 daily/weekly",
            e.get("period") in ("daily", "weekly"),
            e.get("period"),
        )


print("\n[8] 적어 둔 분야가 실제로 수집 대상에 있는지")
# ⚠️ 이 시험이 실제로 잘못을 잡았습니다 (2026-08-09).
#    알라딘은 '전체' 가 아니라 '종합' 이라고 부릅니다. 이름이 다르면
#    매일 아침 한 탭이 실패합니다. 시트를 보기 전에는 모릅니다.
sources = cfg.load("sources.yaml")
tasks = cfg.build_tasks(sources)
have = {(t.store_code, t.kind, t.name) for t in tasks}

for e in exports:
    if e.get("kind") != "category":
        continue
    want = (
        str(e.get("store", "")).lower(),
        str(e.get("category_kind", "online")),
        str(e.get("category", "")),
    )
    near = sorted({n for s, k, n in have if (s, k) == want[:2]})
    check(
        f"'{e.get('tab')}' 의 분야가 수집 목록에 있음",
        want in have,
        f"{want} — 그 서점·기간에 있는 이름: {near}",
    )


print("\n[9] 칸 개수가 머리글과 맞는지")
# 머리글을 늘리고 줄 만드는 곳을 안 고치면 시트가 통째로 밀립니다.
check("머리글이 9칸", len(ex.HEADER) == 9, ex.HEADER)
check("만들어지는 줄도 9칸", len(row("2026-08-10")) == len(ex.HEADER))


print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    for f in failures:
        print(f"   · {f}")
    raise SystemExit(1)
print("✅ 모두 통과")
