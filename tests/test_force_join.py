"""
🚨 [강제로 묶기] 로 누른 것이 다음 매칭에서 도로 풀리지 않는지 봅니다.

【2026-08-12 대표님 요청】
    "다르다고 매칭된 것 중에 내가 수동으로 이어주고 싶은 게 있거든?
     모든 걸 규정화할 수는 없으니까.
     내가 강제로 3개를 묶어줄 수 있는 기능을 만들어도 좋을 것 같고."

버튼을 만드는 것만으로는 부족합니다. 매칭에는 **누른 것을 도로 떼어내는
자리가 두 군데** 있었습니다. 그대로 두면 대표님이 누르시고 저장까지
됐는데 다음 날 아침이면 조용히 원래대로 돌아갑니다.
화면에는 아무 표시도 안 나기 때문에 눈으로는 절대 못 잡습니다.

  ① 비교 묶음 밖이면 아예 지나감
     비교는 '제목 앞 4글자가 같거나 저자가 같은 책들' 끼리만 합니다.
     제목이 아주 다른 두 권을 이으면 비교 대상이 아니라 그냥 넘어갔습니다.

  ② 같은 서점 상품 두 개를 이으면 떼어냄
     "한 서점에 한 권만" 규칙이 사람 결정보다 나중에 돌아서 갈라냈습니다.

실행: python tests/test_force_join.py
※ 인터넷도 DB 도 필요 없습니다.
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

from run_match import (  # noqa: E402
    Groups, apply_manual_merges, split_same_store,
)

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


def rows(*specs):
    """(상품번호, 서점번호) 들 → by_id"""
    return {i: {"id": i, "store_id": s} for i, s in specs}


print("\n[1] 🚨 비교 묶음 밖에 있어도 이어 붙는가")
# 「안녕이라 그랬어」 와 제목이 아주 다른 책을 이어도 먹혀야 합니다.
by_id = rows((10, 1), (20, 2), (30, 3))
g = Groups()
for i in by_id:
    g.find(i)
n = apply_manual_merges(g, {(10, 20): "manual_merge"}, by_id)
check("한 번도 비교 안 된 짝을 이어 붙인다", n == 1 and g.find(10) == g.find(20), n)

# 세 권을 한 번에 (대표님이 말씀하신 '강제로 3개')
g = Groups()
for i in by_id:
    g.find(i)
apply_manual_merges(
    g, {(10, 20): "manual_merge", (10, 30): "manual_merge",
        (20, 30): "manual_merge"}, by_id)
check("3권을 한 무리로 묶는다",
      g.find(10) == g.find(20) == g.find(30))

print("\n[2] 이미 이어져 있으면 두 번 세지 않는다")
g = Groups()
for i in by_id:
    g.find(i)
g.union(10, 20)
check("이미 한 무리면 0건", apply_manual_merges(g, {(10, 20): "manual_merge"}, by_id) == 0)

print("\n[3] 🚨 '다른 책' 은 여기서 이어 붙이면 안 된다")
g = Groups()
for i in by_id:
    g.find(i)
apply_manual_merges(g, {(10, 20): "manual_split"}, by_id)
check("manual_split 은 이어 붙이지 않는다", g.find(10) != g.find(20))

print("\n[4] 사라진 상품이 섞여 있어도 죽지 않는다")
g = Groups()
for i in by_id:
    g.find(i)
# 99 번은 그 사이에 지워진 상품입니다 (by_id 에 없습니다)
try:
    got = apply_manual_merges(g, {(10, 99): "manual_merge"}, by_id)
    check("없는 번호는 건너뛴다", got == 0, got)
except Exception as exc:            # noqa: BLE001
    check("없는 번호는 건너뛴다", False, repr(exc))

print("\n[5] 🚨 같은 서점 상품 두 개를 일부러 이었을 때 (핵심)")
# 대표님이 보내주신 예: 한 서점에 '집 에디션' 과 '집에디션 리커버' 가
# 따로 올라와 있고, 그 둘을 같은 책으로 묶고 싶으신 경우입니다.
same_store = rows((1, 1), (2, 1), (3, 2))   # 1·2 번이 같은 서점(교보)
score = {(1, 3): 90.0, (2, 3): 40.0}

# 사람이 안 이었으면 → 예전대로 한 서점에 한 권만 남습니다
parts = split_same_store([1, 2, 3], same_store, score)
check("사람이 안 이었으면 한 서점에 한 권만 남긴다",
      sorted(map(sorted, parts)) == [[1, 3], [2]], parts)

# 사람이 이었으면 → 같은 서점이어도 그대로 둡니다
parts = split_same_store([1, 2, 3], same_store, score, {(1, 2)})
check("🚨 사람이 이었으면 같은 서점이어도 안 떼어낸다",
      sorted(map(sorted, parts)) == [[1, 2, 3]], parts)

print("\n[6] 그래도 사람이 안 이은 것은 여전히 갈라낸다")
# 한 서점에 세 권 — 그중 둘만 사람이 이었으면 나머지 하나는 떨어집니다.
four = rows((1, 1), (2, 1), (4, 1), (3, 2))
parts = split_same_store([1, 2, 3, 4], four, {(1, 3): 90.0}, {(1, 2)})
check("사람이 이은 것만 남고 나머지는 떨어진다",
      sorted(map(sorted, parts)) == [[1, 2, 3], [4]], parts)

print("\n[7] 🚨 화면·규칙이 서로 맞물려 있는가 (글자로 확인)")
RUN = (ROOT / "crawler" / "run_match.py").read_text(encoding="utf-8")
check("split_same_store 에 사람 결정을 넘겨준다",
      "split_same_store(part, by_id, pair_score, merged_pairs)" in RUN,
      "안 넘기면 [강제로 묶기] 가 다음 날 조용히 풀립니다")
check("비교가 끝난 뒤 사람 결정을 한 번 더 적용한다",
      "apply_manual_merges(groups, manual, by_id)" in RUN)

ROUTE = (ROOT / "web" / "app" / "review" / "join" / "decide" / "route.ts").read_text(
    encoding="utf-8")
check("저장하는 판정은 manual_merge 하나뿐",
      'decision: "manual_merge"' in ROUTE and "auto_high" not in ROUTE)
check("되돌릴 수 있게 원래 판단을 남긴다",
      'auto_decision: "rejected"' in ROUTE,
      "안 남기면 [되돌리기] 가 거부됩니다")
check("관리자만 (화면에서 한 번)", 'role !== "admin"' in ROUTE)
check("누가 눌렀는지 본인 이름으로만", "auth.user.id" in ROUTE)
check("저장된 줄 수를 세어 확인한다", "done !== pairs.length" in ROUTE,
      "안 세면 규칙에 막혀 0줄이 저장돼도 '성공' 이라고 합니다")

SQL = (ROOT / "db" / "force-join.sql").read_text(encoding="utf-8")
check("데이터베이스도 manual_merge 만 허용한다",
      "decision      = 'manual_merge'" in SQL)
check("데이터베이스도 본인 이름만 허용한다", "decided_by    = auth.uid()" in SQL)
check("지우기는 열지 않는다", "GRANT DELETE" not in SQL)

print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    for f in failures:
        print(f"   · {f}")
    raise SystemExit(1)
print("✅ 모두 통과")
