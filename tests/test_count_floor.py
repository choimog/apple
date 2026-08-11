"""
'수집 건수가 너무 적다' 판정 시험.

【왜 이 시험이 생겼나요? — 2026-08-11, 실제로 사고가 났습니다】

대표님 결정으로 일간 1,000위 → 300위, 주간 → 500위로 줄였습니다.
그리고 바로 다음 수집에서 **40개 넘는 분야가 전부 실패**했습니다.

    수집 건수가 비정상적으로 적습니다: 300권 (기준 499권, 평소 999권).
    서점 화면 개편 가능성 → config/selectors.yaml 확인 필요.

300권을 **제대로** 걷어 놓고 실패로 몰린 것입니다. '평소' 가 아직
1,000권으로 남아 있어서 그 절반인 499권을 요구했기 때문입니다.

두 가지가 잘못됐습니다.
  ① 우리가 일부러 줄인 것을 고장이라고 했습니다
  ② 화면 개편도 막힘도 아닌데 "selectors.yaml 을 확인하세요" 라고
     엉뚱한 곳을 가리켰습니다. 그 말을 믿고 멀쩡한 설정을 고치면
     이번엔 진짜로 망가집니다.

그렇다고 이 점검을 없애면 안 됩니다. **서점이 조용히 화면을 바꿔서
절반만 걷히는 것**을 잡아내는 유일한 그물이기 때문입니다.
그래서 '평소' 와 '받기로 한 양' 중 작은 쪽을 기준으로 삼습니다.

실행: python tests/test_count_floor.py
※ 인터넷도 DB 도 필요 없습니다.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

# DB 도 인터넷도 없이 돌아야 합니다 (수집 workflow 안에서 매일 돕니다)
_fake = types.ModuleType("supabase")
_fake.Client = object
_fake.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _fake)

# 인터넷 도구도 흉내만 냅니다. 여기서는 계산 규칙만 봅니다.
_hx = types.ModuleType("httpx")
for _n in ("Client", "Response", "Request", "Timeout", "Limits", "HTTPError",
           "TimeoutException", "ConnectError", "ReadTimeout", "HTTPStatusError"):
    setattr(_hx, _n, type(_n, (Exception,), {}))
sys.modules.setdefault("httpx", _hx)

from run_daily import count_floor  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


def passes(collected: int, baseline: int, want: int, reached_end: bool) -> bool:
    _, floor = count_floor(baseline, want, reached_end)
    return collected >= floor


print("\n[1] 🚨 우리가 일부러 줄인 것을 고장이라고 하지 않는다 (실제 사고)")
# 실제로 실패했던 값들입니다. 전부 통과해야 합니다.
real = [
    ("교보 전체", 300, 999, 300),
    ("교보 소설", 300, 998, 300),
    ("예스24 전체", 300, 1000, 300),
    ("알라딘 종합", 300, 1000, 300),
    ("예스24 에세이", 300, 787, 300),
    ("알라딘 사회과학", 300, 619, 300),
]
for label, collected, baseline, want in real:
    check(f"{label}: {collected}권 (평소 {baseline}) → 통과",
          passes(collected, baseline, want, reached_end=False),
          count_floor(baseline, want, False))

# 주간도 마찬가지입니다 (500위로 줄임)
check("주간 500권 (평소 1000) → 통과", passes(500, 1000, 500, False))

print("\n[2] 🚨 그래도 진짜 고장은 여전히 잡는다 (그물을 없애면 안 됩니다)")
# 서점이 조용히 화면을 바꿔 절반만 걷히는 것을 잡는 유일한 방법입니다.
check("받기로 한 300권 중 100권만 → 실패", not passes(100, 999, 300, False),
      count_floor(999, 300, False))
check("받기로 한 300권 중 149권만 → 실패", not passes(149, 999, 300, False))
check("받기로 한 300권 중 150권 → 통과 (경계)", passes(150, 999, 300, False))
check("주간 500권 중 200권만 → 실패", not passes(200, 1000, 500, False))

print("\n[3] 목록이 진짜 짧은 분야를 죽이지 않는다")
# 알라딘 달력/기타처럼 목록 자체가 24권뿐인 분야가 있습니다.
# 끝까지 봤다면 그 숫자가 곧 목록의 길이입니다.
check("끝까지 봤고 평소도 24권이면 통과", passes(24, 24, 300, True))
check("끝까지 봤으면 기준이 더 느슨하다(25%)",
      count_floor(300, 300, True)[1] == 75, count_floor(300, 300, True))
check("끝을 못 봤으면 기준이 엄하다(50%)",
      count_floor(300, 300, False)[1] == 150, count_floor(300, 300, False))

print("\n[4] 처음 수집하는 분야")
# 비교할 '평소' 가 없습니다. 여기서 높은 기준을 걸면 첫날이 통째로 죽습니다.
check("평소가 없으면 아주 낮은 기준", count_floor(0, 300, False)[1] == 10,
      count_floor(0, 300, False))
check("첫날 10권이면 통과", passes(10, 0, 300, False))
check("첫날 9권이면 실패", not passes(9, 0, 300, False))

print("\n[5] 이상한 값에도 안 터진다")
check("받기로 한 양을 모르면 평소를 그대로 쓴다",
      count_floor(1000, 0, False)[1] == 500, count_floor(1000, 0, False))
check("둘 다 0", count_floor(0, 0, False)[1] == 10, count_floor(0, 0, False))
check("받기로 한 양이 평소보다 크면 평소를 쓴다",
      count_floor(300, 1000, False)[1] == 150, count_floor(300, 1000, False))

print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    for f in failures:
        print(f"   · {f}")
    raise SystemExit(1)
print("✅ 모두 통과")
