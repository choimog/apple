"""
보관 파일 만료 알림이 제때 울리고, 제때 조용한지 시험.

【왜 필요한가요? — 2026-08-09】
GitHub 보관은 90일이 지나면 파일을 지웁니다. 한 번 사라지면 되살릴 수
없습니다. 그래서 "사라지기 전에 알리는" 이 규칙은 조용히 틀리면 안 됩니다.

특히 두 가지가 반대로 되면 치명적입니다.
  · 울려야 할 때 조용하면 → 자료가 사라집니다
  · 안 울려야 할 때 울리면 → 매주 오는 메일을 무시하게 되고,
                            결국 진짜 알림도 무시하게 됩니다

실행: python tests/test_archive_expiry.py
"""

from __future__ import annotations

import sys
import types
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

fake = types.ModuleType("supabase")
fake.Client = object
fake.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", fake)

from archive import (  # noqa: E402
    days_until,
    do_check_expiry,
    do_mark_saved,
    group_by_run,
)

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got else ""))
        failures.append(name)


TODAY = date.today()


def d(offset: int) -> str:
    return (TODAY + timedelta(days=offset)).isoformat()


class FakeDB:
    """
    보관 기록표만 흉내내는 가짜 DB.

    ⚠️ 진짜 코드가 쓰는 조건(storage='github', expires_at 있음,
       saved_at 비어 있음)을 여기서도 그대로 걸러야 합니다.
       안 그러면 시험은 통과하는데 실제로는 엉뚱한 줄을 집습니다.
    """

    def __init__(self, rows: list[dict]):
        self.rows = [dict(r) for r in rows]
        self.updates: list[tuple[str, str, dict]] = []
        self._filters: list = []
        self._patch: dict = {}
        self._mode = ""

    # ---- 읽기 ----
    def table(self, name):
        self._table = name
        self._filters = []
        self._mode = ""
        return self

    def select(self, *a, **k):
        self._mode = "select"
        return self

    def eq(self, col, val):
        self._filters.append(("eq", col, val))
        return self

    @property
    def not_(self):
        self._negate = True
        return self

    def is_(self, col, val):
        neg = getattr(self, "_negate", False)
        self._negate = False
        self._filters.append(("isnot" if neg else "is", col, val))
        return self

    def order(self, col, **k):
        self._order = col
        return self

    # ---- 쓰기 ----
    def update(self, patch):
        self._mode = "update"
        self._patch = patch
        return self

    def execute(self):
        picked = [r for r in self.rows if self._match(r)]
        if self._mode == "update":
            for r in picked:
                r.update(self._patch)
                self.updates.append(
                    (r["snapshot_date"], r["table_name"], dict(self._patch))
                )
            return types.SimpleNamespace(data=picked)
        picked.sort(key=lambda r: r.get(getattr(self, "_order", ""), "") or "")
        return types.SimpleNamespace(data=picked)

    def _match(self, r: dict) -> bool:
        for kind, col, val in self._filters:
            if kind == "eq" and r.get(col) != val:
                return False
            if kind == "is" and val == "null" and r.get(col) is not None:
                return False
            if kind == "isnot" and val == "null" and r.get(col) is None:
                return False
        return True


def row(day: str, expires: str | None, saved=None, table="rankings",
        storage="github") -> dict:
    return {
        "snapshot_date": day,
        "table_name": table,
        "expires_at": expires,
        "run_url": "https://example.test/run/1",
        "saved_at": saved,
        "storage": storage,
    }


print("=" * 66)
print("  보관 파일 만료 알림")
print("=" * 66)

print("\n[1] 남은 날짜 계산")
check("오늘이면 0일", days_until(d(0), TODAY) == 0)
check("내일이면 1일", days_until(d(1), TODAY) == 1)
check("어제면 -1일 (지났음을 감춘다면 큰일)", days_until(d(-1), TODAY) == -1)

print("\n[2] 한 번에 올린 것은 한 덩어리로 묶는다")
# 한 번 실행에 14일치 × 2개 표 = 28줄이 나옵니다.
# 메일에 28줄을 그대로 적으면 무엇을 해야 할지 안 보입니다.
rows = []
for i in range(14):
    for t in ("rankings", "book_meta"):
        rows.append(row(d(-100 + i), d(20), table=t))
groups = group_by_run(rows)
check("28줄이 1묶음이 된다", len(groups) == 1, len(groups))
check("파일 수를 세어둔다", groups[0]["files"] == 28, groups[0]["files"])
check("날짜 14일치를 담는다", len(groups[0]["dates"]) == 14)

print("\n[3] 사라질 것이 없으면 성공(메일 없음)")
check("빈 표 → 0", do_check_expiry(FakeDB([]), 30) == 0)

print("\n[4] 아직 여유가 있으면 성공(메일 없음)")
db_far = FakeDB([row(d(-100), d(80))])
check("80일 남음 → 0", do_check_expiry(db_far, 30) == 0)

print("\n[5] 30일 밑이면 실패(=메일)")
db_near = FakeDB([row(d(-100), d(12))])
check("12일 남음 → 1", do_check_expiry(db_near, 30) == 1)

print("\n[6] 경계값을 놓치지 않는다")
# 딱 30일 남았을 때 조용하면, 다음 주에는 23일이 됩니다.
# 매주 목요일에만 도니까 경계에서 새면 한 주를 통째로 잃습니다.
check("딱 30일 → 1 (울려야 함)", do_check_expiry(FakeDB([row(d(-1), d(30))]), 30) == 1)
check("31일 → 0 (아직 조용)", do_check_expiry(FakeDB([row(d(-1), d(31))]), 30) == 0)

print("\n[7] 내려받았다고 표시한 것은 조용하다")
db_saved = FakeDB([row(d(-100), d(3), saved="2026-08-09T00:00:00Z")])
check("saved_at 이 있으면 → 0", do_check_expiry(db_saved, 30) == 0)

print("\n[8] R2 로 보관한 것은 알림 대상이 아니다")
# R2 는 영구 보관이라 사라지지 않습니다. 여기 섞이면 헛알림이 갑니다.
db_r2 = FakeDB([row(d(-100), d(3), storage="r2")])
check("storage=r2 → 0", do_check_expiry(db_r2, 30) == 0)

print("\n[9] '내려받음' 표시가 실제로 칸을 채운다")
db_mark = FakeDB([row(d(-100), d(10)), row(d(-100), d(10), table="book_meta")])
rc = do_mark_saved(db_mark)
check("성공으로 끝난다", rc == 0)
check("2개 줄을 고쳤다", len(db_mark.updates) == 2, db_mark.updates)
check("saved_at 을 채웠다", all(u[2].get("saved_at") for u in db_mark.updates))
check("표시 뒤에는 조용해진다", do_check_expiry(db_mark, 30) == 0)

print("\n[10] 이미 사라진 파일은 표시하지 않는다")
# 이미 없어진 것을 '받았다' 고 표시하면, 없는 자료를 있다고 착각하게 됩니다.
db_gone = FakeDB([row(d(-100), d(-5))])
do_mark_saved(db_gone)
check("지난 것은 건드리지 않는다", db_gone.updates == [], db_gone.updates)

print("\n" + "=" * 66)
if failures:
    print(f"  ❌ 실패 {len(failures)}건: {', '.join(failures)}")
    raise SystemExit(1)
print("  ✅ 전부 통과")
raise SystemExit(0)
