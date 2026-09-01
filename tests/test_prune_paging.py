"""
🚨 [도서 목록 정리] 가 **1,000줄만 지우고 끝내지 않는지** 시험.

【2026-09-01 실제로 겪은 고장 — 가장 위험한 종류였습니다】
정리 작업이 **매일 '성공'** 으로 끝나는데도 용량이 계속 늘었습니다.
로그를 열어 보고서야 알았습니다.

    ▶ 잠든 상품을 고릅니다 (기준 14일 · 최대 80,000줄)
      잠든 상품 1,000줄          ← 지울 대상은 8,975개였습니다
      🗑️ 상품 1,000줄을 지웁니다…

Supabase 는 **한 번에 1,000줄까지만** 돌려줍니다. 8만 줄을 달라고 해도
1,000줄만 옵니다. 표를 읽을 때는 이 처리를 해 뒀는데(_select_all),
계산 함수를 부를 때는 빠져 있었습니다.

    하루에 들어오는 상품  2,500~3,000줄
    하루에 지우는 상품    1,000줄
    → 매일 순증. 그런데 작업은 초록 체크. 아무 표시도 안 났습니다.

**조용히 절반만 하는 고장** 이라 사람이 로그를 열어 보기 전에는 못 잡습니다.
그래서 기계가 봅니다.

실행: python tests/test_prune_paging.py
※ 인터넷도 데이터베이스도 필요 없습니다 (1,000줄 제한을 흉내 냅니다).
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

_fake = types.ModuleType("supabase")
_fake.Client = object
_fake.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _fake)

from common import db  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


# ---------------------------------------------------------------------------
#  Supabase 를 흉내 냅니다 — **한 번에 1,000줄까지만** 돌려주는 것이 핵심
# ---------------------------------------------------------------------------
HARD_CAP = 1000


class FakeRPC:
    def __init__(self, owner, fn, params):
        self.owner, self.fn, self.params = owner, fn, params
        self.start, self.end = 0, None

    def range(self, start, end):
        self.start, self.end = start, end
        return self

    def execute(self):
        rows = self.owner.rows
        # 함수 안의 p_limit 이 먼저 자릅니다 (실제 SQL 과 같은 순서)
        rows = rows[: self.params.get("p_limit", len(rows))]
        want = (self.end - self.start + 1) if self.end is not None else HARD_CAP
        # 🚨 서버가 아무리 많이 달래도 1,000줄까지만 줍니다
        got = rows[self.start : self.start + min(want, HARD_CAP)]
        self.owner.calls.append((self.start, self.end, len(got)))
        return types.SimpleNamespace(data=got)


class FakeClient:
    def __init__(self, n: int):
        self.rows = [{"id": i, "book_id": i} for i in range(1, n + 1)]
        self.calls: list[tuple] = []

    def rpc(self, fn, params):
        return FakeRPC(self, fn, params)


# ---------------------------------------------------------------------------
print("\n[1] 🚨 1,000줄이 넘어도 끝까지 받아온다 (실제 사고)")

c = FakeClient(8975)          # 그날 실제로 밀려 있던 수
rows = db.rpc_all(c, "dormant_store_books", {"p_days": 14, "p_limit": 80000})
check("8,975줄을 전부 받았다", len(rows) == 8975, len(rows))
check("나눠서 받았다 (9번)", len(c.calls) == 9, c.calls)
check("빠뜨린 줄이 없다", {r["id"] for r in rows} == set(range(1, 8976)))
check("겹쳐 받은 줄이 없다", len({r["id"] for r in rows}) == len(rows))

# 예전 방식이었다면 어떻게 됐는지 — 시험이 진짜 의미가 있는지 확인
old = c.rpc("dormant_store_books", {"p_days": 14, "p_limit": 80000}).execute().data
check("🚨 예전 방식(한 번에 부르기)은 1,000줄뿐이었다", len(old) == 1000, len(old))


# ---------------------------------------------------------------------------
print("\n[2] 딱 떨어지는 수·적은 수·0개에서도 멀쩡한가")

for n, want_calls in ((0, 1), (1, 1), (999, 1), (1000, 2), (2000, 3), (2001, 3)):
    c = FakeClient(n)
    rows = db.rpc_all(c, "f", {"p_limit": 80000})
    check(f"{n:>5}줄 → 전부 받음", len(rows) == n, len(rows))
    # 1,000의 배수일 때 '한 번 더 물어보고 빈 결과를 받아야' 끝납니다.
    # 그 한 번을 빼먹으면 마지막 묶음을 통째로 놓칩니다.
    check(f"{n:>5}줄 → 부른 횟수 {want_calls}번", len(c.calls) == want_calls, c.calls)


# ---------------------------------------------------------------------------
print("\n[3] 🚨 끝없이 도는 일이 없다 (안전장치)")
# 서버가 고장 나서 같은 줄을 계속 돌려주면 무한히 돌 수 있습니다.


class StuckClient(FakeClient):
    """무엇을 물어봐도 늘 1,000줄을 돌려주는 고장난 서버"""

    def rpc(self, fn, params):
        rpc = FakeRPC(self, fn, params)
        rpc.execute = lambda: (
            self.calls.append(("stuck",)),
            types.SimpleNamespace(data=[{"id": 1}] * HARD_CAP),
        )[1]
        return rpc


c = StuckClient(0)
rows = db.rpc_all(c, "f", {"p_limit": 80000}, max_rows=5000)
check("한도에서 멈춘다", len(c.calls) == 5, len(c.calls))
check("멈출 때까지 받은 것은 돌려준다", len(rows) == 5000, len(rows))


# ---------------------------------------------------------------------------
print("\n[4] 정리 작업이 실제로 이 방법을 쓰는가")
src = (ROOT / "crawler" / "prune_catalog.py").read_text(encoding="utf-8")

check("잠든 상품을 나눠서 받는다",
      'db.rpc_all(\n            client, "dormant_store_books"' in src
      or 'rpc_all(client, "dormant_store_books"' in src.replace("\n", " "),
      "여기가 예전 방식이면 하루 1,000줄만 지웁니다")
check("껍데기 묶음도 나눠서 받는다", 'rpc_all(client, "orphan_books"' in src)
check(
    "🚨 예전 방식이 남아 있지 않다",
    'client.rpc("dormant_store_books"' not in src
    and 'client.rpc("orphan_books"' not in src,
    src.count('client.rpc('),
)

# 함수 안의 상한이 받으려는 양보다 커야 합니다. 작으면 먼저 잘립니다.
cfgtxt = (ROOT / "config" / "archive.yaml").read_text(encoding="utf-8")
import re  # noqa: E402
m = re.search(r"^catalog_max_rows:\s*(\d+)", cfgtxt, re.M)
check("한 번에 정리할 상한이 설정에 있다", bool(m), cfgtxt[:0])
if m:
    check(f"그 상한({int(m.group(1)):,})이 넉넉하다 (1만 이상)",
          int(m.group(1)) >= 10000, int(m.group(1)))


# ---------------------------------------------------------------------------
print("\n[5] 나눠 받으려면 계산이 늘 같은 차례여야 한다")
# 차례가 흔들리면 어떤 줄은 두 번 받고 어떤 줄은 영영 못 받습니다.
sql = (ROOT / "db" / "prune-catalog.sql").read_text(encoding="utf-8")
for fn in ("dormant_store_books", "orphan_books"):
    body = sql[sql.index(f"FUNCTION public.{fn}"):]
    body = body[: body.index("$$;")]
    check(f"{fn} 에 ORDER BY 가 있다", "ORDER BY" in body,
          "차례가 없으면 나눠 받을 때 빠지는 줄이 생깁니다")


# ---------------------------------------------------------------------------
print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    raise SystemExit(1)
print("✅ 모두 통과")
