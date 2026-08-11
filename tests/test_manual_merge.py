"""
검토 화면에서 [같은 책입니다] 를 누른 것이 **끝까지 살아남는지** 시험.

【왜 필요한가요? — 2026-08-11 대표님 신고】
"여기서는 같은 책이라고 내가 다 체크하고, 깃허브에서 실행까지 시켰는데,
 왜 얘는 하나의 도서페이지로 합쳐지지 않지?"

『어떻게 살아낼 것인가』 세 서점을 전부 '같은 책' 으로 체크하셨는데
묶인 권수가 2·1·2 로 남아 있었습니다.

원인은 출판사 표기였습니다.
    알라딘·교보  필름(Feelm)
    예스24       필름
닮은 정도가 24% 라 기준(80%)에 못 미쳐서, '출판사가 섞인 무리를 갈라내는'
단계가 예스24를 **다시 떼어냈습니다.**

그 단계 자체는 필요합니다. 민음사 싯다르타와 문학동네 싯다르타가 가운데
출판사 모르는 책을 다리 삼아 한 권이 되는 것을 막아 줍니다.
문제는 **사람이 이미 판단한 것까지 되돌렸다**는 점입니다.
코드에는 "사람이 내린 결정이 최우선" 이라고 적어 두고, 이 자리에서만
기계가 이겼습니다. 게다가 아무 표시도 안 나서, 대표님이 직접 발견하실
때까지 아무도 몰랐습니다.

실행: python tests/test_manual_merge.py
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

from run_match import rejoin_manual_merges, split_by_publisher  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


def norm(parts):
    """비교하기 쉽게 정렬합니다"""
    return sorted(sorted(p) for p in parts)


# -----------------------------------------------------------------------------
print("\n[1] 대표님이 겪으신 그대로 재현 — 『어떻게 살아낼 것인가』")
# 1 = 알라딘 필름(Feelm) · 2 = 예스24 필름 · 3 = 교보 필름(Feelm)
by_id = {
    1: {"store_id": 3, "norm_publisher": "필름feelm"},
    2: {"store_id": 2, "norm_publisher": "필름"},
    3: {"store_id": 1, "norm_publisher": "필름feelm"},
}
pair_score = {(1, 2): 85.0, (2, 3): 85.0, (1, 3): 100.0}

parts = split_by_publisher([1, 2, 3], by_id, pair_score, 0.80)
check("출판사 표기가 달라 갈라진다 (이것 자체는 규칙대로)",
      len(parts) == 2, norm(parts))
check("예스24가 혼자 떨어진다", [2] in norm(parts), norm(parts))

print("\n[2] 🚨 사람이 '같은 책' 이라고 하면 다시 합친다")
merged = {(1, 2), (2, 3), (1, 3)}
joined = rejoin_manual_merges(parts, merged)
check("한 무리로 돌아온다", len(joined) == 1, norm(joined))
check("세 권이 다 들어 있다", norm(joined) == [[1, 2, 3]], norm(joined))

print("\n[2-1] 한 짝만 체크해도 이어진다")
# 1─2 만 체크해도, 1과 3은 이미 같은 무리이므로 셋이 다 이어집니다
one = rejoin_manual_merges(parts, {(1, 2)})
check("1─2 만 체크해도 셋이 이어진다", norm(one) == [[1, 2, 3]], norm(one))

print("\n[3] 체크 안 한 것까지 멋대로 합치지는 않는다")
# 이게 무너지면 출판사가 다른 책들이 전부 한 권이 됩니다.
none = rejoin_manual_merges(parts, set())
check("체크가 없으면 그대로 둔다", norm(none) == norm(parts), norm(none))

other = rejoin_manual_merges(parts, {(7, 8)})
check("상관없는 짝은 아무 영향 없다", norm(other) == norm(parts), norm(other))

print("\n[3-1] 진짜 다른 책은 그대로 갈라져 있어야 한다")
# 민음사 싯다르타 ─ (출판사 모름) ─ 문학동네 싯다르타
sid = {
    10: {"store_id": 1, "norm_publisher": "민음사"},
    11: {"store_id": 2, "norm_publisher": None},
    12: {"store_id": 3, "norm_publisher": "문학동네"},
}
sid_parts = split_by_publisher([10, 11, 12], sid, {(10, 11): 80.0, (11, 12): 70.0}, 0.80)
check("출판사가 진짜 다르면 갈라진다", len(sid_parts) == 2, norm(sid_parts))
check("체크가 없으면 합쳐지지 않는다",
      norm(rejoin_manual_merges(sid_parts, set())) == norm(sid_parts))

print("\n[4] 이상한 값이 와도 안 터진다")
check("조각이 하나뿐", rejoin_manual_merges([[1, 2]], {(1, 2)}) == [[1, 2]])
check("조각이 없음", rejoin_manual_merges([], {(1, 2)}) == [])
check("같은 조각 안의 짝은 그대로",
      norm(rejoin_manual_merges([[1, 2], [3]], {(1, 2)})) == [[1, 2], [3]])

print("\n[5] 네 조각도 이어서 합친다")
four = [[1], [2], [3], [4]]
check("1─2, 3─4 는 두 무리로",
      norm(rejoin_manual_merges(four, {(1, 2), (3, 4)})) == [[1, 2], [3, 4]])
check("1─2, 2─3, 3─4 는 한 무리로",
      norm(rejoin_manual_merges(four, {(1, 2), (2, 3), (3, 4)})) == [[1, 2, 3, 4]])


print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    for f in failures:
        print(f"   · {f}")
    raise SystemExit(1)
print("✅ 모두 통과")
