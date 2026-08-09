"""
검토 화면에서 [다른 책입니다] 를 누른 것이 실제로 갈라지는지 시험.

【왜 필요한가요? — 2026-08-09】
예전 코드는 '사람이 다른 책이라고 한 짝이 한 무리가 됐다' 는 것을
**경고만** 하고 넘어갔습니다. 그러면 대표님은 버튼을 눌렀고
'저장했습니다' 도 보셨는데 화면은 그대로입니다.

버튼이 거짓말을 하는 셈입니다. 그래서 실제로 갈라내도록 고쳤고,
다시는 조용히 넘어가지 않도록 여기서 붙잡아 둡니다.

실행: python tests/test_manual_split.py
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

from run_match import split_by_manual  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


def parts_of(result: list[list[int]]) -> set[frozenset[int]]:
    return {frozenset(p) for p in result}


def together(result: list[list[int]], a: int, b: int) -> bool:
    return any(a in p and b in p for p in result)


print("=" * 66)
print("  사람이 '다른 책' 이라고 한 짝 갈라내기")
print("=" * 66)

print("\n[1] 누르지 않았으면 아무것도 안 건드린다")
r = split_by_manual([1, 2, 3], [(90.0, 1, 2), (88.0, 2, 3)], set())
check("무리가 그대로", parts_of(r) == {frozenset({1, 2, 3})}, r)

print("\n[2] 직접 이어진 짝을 갈라낸다")
r = split_by_manual([1, 2], [(70.0, 1, 2)], {(1, 2)})
check("둘로 갈라진다", not together(r, 1, 2), r)
check("책이 사라지지 않는다", sorted(x for p in r for x in p) == [1, 2], r)

print("\n[3] 다른 책을 다리 삼아 이어진 것도 갈라낸다")
# A ─ C ─ B  에서 A-B 가 '다른 책'.
# 예전에는 이 경우를 경고만 하고 넘어갔습니다.
r = split_by_manual([1, 2, 3], [(90.0, 1, 3), (70.0, 3, 2)], {(1, 2)})
check("1 과 2 가 갈라진다", not together(r, 1, 2), r)
check("약한 연결(70점)이 끊긴다 — 1·3 은 붙어 있다", together(r, 1, 3), r)
check("책이 사라지지 않는다", sorted(x for p in r for x in p) == [1, 2, 3], r)

print("\n[4] 점수 순서를 바꾸면 끊기는 쪽도 바뀐다")
# 이번에는 3-2 가 더 강합니다. 약한 1-3 이 끊겨야 합니다.
r = split_by_manual([1, 2, 3], [(70.0, 1, 3), (95.0, 3, 2)], {(1, 2)})
check("1 과 2 가 갈라진다", not together(r, 1, 2), r)
check("강한 연결(95점)은 남는다 — 3·2 는 붙어 있다", together(r, 3, 2), r)

print("\n[5] 사람이 '같은 책' 이라고 한 것은 기계 점수를 이긴다")
# 1-3 은 사람이 [같은 책] (무한대), 3-2 는 기계 99점.
# 1-2 가 '다른 책' 이므로 하나는 끊어야 하는데, 사람 쪽이 남아야 합니다.
r = split_by_manual(
    [1, 2, 3], [(float("inf"), 1, 3), (99.0, 3, 2)], {(1, 2)}
)
check("1 과 2 가 갈라진다", not together(r, 1, 2), r)
check("사람이 누른 1·3 은 남는다", together(r, 1, 3), r)

print("\n[6] 여러 짝을 동시에 눌러도 된다")
r = split_by_manual(
    [1, 2, 3, 4],
    [(90.0, 1, 2), (85.0, 2, 3), (80.0, 3, 4)],
    {(1, 3), (2, 4)},
)
check("1·3 이 갈라진다", not together(r, 1, 3), r)
check("2·4 가 갈라진다", not together(r, 2, 4), r)
check("책이 사라지지 않는다",
      sorted(x for p in r for x in p) == [1, 2, 3, 4], r)

print("\n[7] 무리 밖의 짝은 무시한다")
# 다른 무리의 결정이 이 무리를 건드리면 안 됩니다.
r = split_by_manual([1, 2], [(90.0, 1, 2)], {(7, 8)})
check("그대로 둔다", parts_of(r) == {frozenset({1, 2})}, r)

print("\n[8] 너무 큰 무리는 손대지 않는다 (조용히 느려지지 않게)")
big = list(range(1, 100))
r = split_by_manual(big, [(90.0, 1, 2)], {(1, 2)}, max_members=60)
check("통째로 돌려준다", parts_of(r) == {frozenset(big)}, len(r))
# ⚠️ 이때는 run_match.py 가 '갈라내지 못했다' 고 크게 알립니다.
#    조용히 넘어가면 버튼이 거짓말을 한 것이 됩니다.

print("\n[9] 이어진 기록이 없으면 전부 흩어진다")
# 이런 무리는 생길 수 없지만, 들어와도 터지지 않아야 합니다.
r = split_by_manual([1, 2, 3], [], {(1, 2)})
check("각자 혼자가 된다", len(r) == 3, r)

print("\n[10] 혼자인 무리")
check("그대로", split_by_manual([5], [], {(1, 2)}) == [[5]])

print("\n" + "=" * 66)
if failures:
    print(f"  ❌ 실패 {len(failures)}건: {', '.join(failures)}")
    raise SystemExit(1)
print("  ✅ 전부 통과")
raise SystemExit(0)
