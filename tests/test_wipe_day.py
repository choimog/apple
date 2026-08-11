"""
하루치 자료 지우기(crawler/wipe_day.py)와, 순위 정리(trim_ranks.py)의
'1,000줄 한계' 규칙 시험.

【왜 이 시험이 생겼나요? — 2026-08-11, 실제로 자료를 잃었습니다】

대표님 신고: "서점별에서 보면 한 서점에서도 순위가 누락된 것처럼
보이는 게 굉장히 많아. 이럼 안 되는데..."

원인은 제 코드였습니다.

    client.table("rankings").select(...).in_("store_book_id", chunk).execute()

Supabase 는 **한 번에 1,000줄까지만** 돌려줍니다. 상품 300개의 순위
줄은 4,000줄이 넘습니다. 그래서 뒤쪽 상품들은 '순위가 하나도 없는 책'
처럼 보였고, **순위에 멀쩡히 있던 책이 지워졌습니다.**
게다가 rankings 는 store_books 에 ON DELETE CASCADE 로 걸려 있어서,
그 책의 순위 줄까지 데이터베이스가 함께 지웠습니다.

db._select_all 은 바로 이 한계 때문에 만들어 둔 도구인데, 정작 가장
위험한 자리에서 안 썼습니다. 다시는 못 그러게 글자로 못박습니다.

실행: python tests/test_wipe_day.py
※ 인터넷도 DB 도 필요 없습니다.
"""

from __future__ import annotations

import re
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

_fake = types.ModuleType("supabase")
_fake.Client = object
_fake.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _fake)

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


WIPE = (ROOT / "crawler" / "wipe_day.py").read_text(encoding="utf-8")
TRIM = (ROOT / "crawler" / "trim_ranks.py").read_text(encoding="utf-8")

print("\n[1] 🚨 1,000줄 한계 — 나눠서 전부 읽는가 (실제 자료 손실 원인)")
# 이 두 조회가 통째 .execute() 로 돌아가면 또 자료를 잃습니다.
for label, src in (("wipe_day.py", WIPE), ("trim_ranks.py", TRIM)):
    # 'rankings' 를 store_book_id 로 훑는 조회는 반드시 _select_all 안에
    # 들어 있어야 합니다.
    bad = re.search(
        r'client\.table\("rankings"\)\s*\.select\([^)]*\)\s*\n?\s*'
        r'\.in_\("store_book_id"[^\n]*\n?\s*\)?\s*\.execute\(\)',
        src,
    )
    check(f"{label}: 순위 조회를 통째로 하지 않는다", bad is None,
          bad.group() if bad else None)
    check(f"{label}: 순위 조회에 _select_all 을 쓴다",
          "_select_all(" in src and 'table("rankings")' in src)
    check(f"{label}: 사람 결정 조회에도 _select_all 을 쓴다",
          re.search(r"_select_all\(\s*\n?\s*lambda c=col", src) is not None)

print("\n[2] 지우면 안 되는 것을 지키는가")
for label, src in (("wipe_day.py", WIPE), ("trim_ranks.py", TRIM)):
    check(f"{label}: 결정이 걸린 상품을 찾아낸다",
          'in_("decision", ["manual_merge", "manual_split"])' in src)
    check(f"{label}: 양쪽 칸을 모두 본다",
          'for col in ("store_book_a", "store_book_b")' in src)
    check(f"{label}: 지울 목록에서 뺀다", "i not in locked" in src)
    check(f"{label}: 시작·종료 건수를 비교한다",
          "before = " in src and ("after != before" in src or "after == before" in src))

print("\n[3] wipe_day 는 날짜를 제대로 가려 받는가")
# 날짜를 잘못 받아 엉뚱한 날을 지우면 되돌릴 수 없습니다.
check("날짜 모양을 검사한다", r'\d{4}-\d{2}-\d{2}' in WIPE)
check("all 이면 전부를 뜻한다", 'target.lower() == "all"' in WIPE)
check("날짜가 비면 아무것도 안 하고 끝낸다", "지울 날짜를 안 알려" in WIPE)
check("날짜 하나씩만 건드린다", '.eq(col, day)' in WIPE)
# 🚨 조건 없는 지우기는 절대 안 됩니다. 한 줄 실수로 전부 날아갑니다.
import re as _re
check("조건 없는 delete() 가 없다",
      _re.search(r'\.delete\(\)\s*\.execute\(\)', WIPE) is None,
      "delete().execute() 는 조건 없이 지웁니다")
# 🚨 2026-08-11 실제 오류:
#    snapshot_dates 가 '2026-08-08' 이 아니라
#    {'snapshot_date': '2026-08-08'} 같은 표 모양으로 돌려주는데
#    그걸 그대로 날짜라고 넘겨서 죽었습니다.
#      invalid input syntax for type date: "{'snapshot_date': '2026-08-08'}"
#    이제 표에 남아 있는 날짜를 매번 직접 물어봅니다.
check("날짜를 표에서 직접 꺼내 쓴다", "rows[0][col]" in WIPE)
check("미리 만든 날짜 목록에 기대지 않는다", "snapshot_dates" not in WIPE,
      "목록에서 빠진 날짜는 영영 안 지워집니다")
check("남은 날짜가 없어질 때까지 돈다", "while True:" in WIPE)
check("무한히 도는 것을 막는 장치가 있다", "done > 400" in WIPE)

print("\n[3-1] 🚨 칸 이름을 짐작하지 않는가 — db/schema.sql 과 대조 (실제 사고)")
# 2026-08-11: daily_reports 의 날짜 칸을 snapshot_date 라고 짐작해서 썼는데
# 실제로는 report_date 였습니다.
#     column daily_reports.snapshot_date does not exist
# 순위·수집기록은 이미 지워진 뒤라 **반쯤 지워진 채로** 멈췄습니다.
# 이제 진짜 표 설계도와 맞대 봅니다.
from trim_ranks import caps_from_config  # noqa: F401  (crawler 경로 확인용)
from wipe_day import TABLES  # noqa: E402

SCHEMA = (ROOT / "db" / "schema.sql").read_text(encoding="utf-8")


def columns_of(table: str) -> set[str]:
    """db/schema.sql 에서 그 표의 칸 이름을 뽑습니다."""
    m = re.search(
        r"CREATE TABLE IF NOT EXISTS " + table + r"\s*\((.*?)\n\);",
        SCHEMA, re.S)
    if not m:
        return set()
    return set(re.findall(r"^\s{4}([a-z_]+)\s+\S", m.group(1), re.M))


check("지울 표가 셋 다 들어 있다", len(TABLES) == 3, TABLES)
for table, col, label in TABLES:
    cols = columns_of(table)
    check(f"{table} 를 설계도에서 찾는다", bool(cols), sorted(cols))
    check(f"🚨 {table}.{col} 칸이 진짜 있다", col in cols,
          f"있는 칸: {sorted(cols)}")

# 한 표가 잘못돼도 나머지는 끝까지 해야 합니다.
# 중간에 통째로 멈추면 반쯤 지워진 채로 남습니다.
check("표 하나가 실패해도 나머지를 계속한다",
      "나머지는 계속 진행합니다" in WIPE)
check("실패한 표를 끝에 모아서 알려준다", "이 표는 못 지웠습니다" in WIPE)

print("\n[4] 무엇을 지우는지 빠짐없이 다루는가")
for t in ("rankings", "crawl_logs", "daily_reports"):
    check(f"{t} 를 지운다", f'"{t}"' in WIPE)
check("고아 상품도 정리한다", 'table("store_books").delete()' in WIPE)
check("빈 도서 묶음도 정리한다", "delete_orphan_books" in WIPE)

print("\n[5] 확인만 하는 길(dry run)이 있는가")
check("DRY_RUN 을 읽는다", 'os.environ.get("DRY_RUN"' in WIPE)
check("dry 면 상품을 안 지운다", "if not dry:" in WIPE)

print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    for f in failures:
        print(f"   · {f}")
    raise SystemExit(1)
print("✅ 모두 통과")
