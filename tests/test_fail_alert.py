"""
수집 실행을 '성공' 으로 볼지 '실패' 로 볼지 판단하는 규칙 시험.

【왜 이 시험이 필요한가요? — 2026-08-08】
GitHub 은 '실패' 로 끝난 실행에만 메일을 보냅니다. 그래서 이 판단이
곧 "언제 연락을 받는가" 입니다.

예전 규칙은 '전부 실패' 일 때만 실패로 봤습니다. 91개 중 90개가 망가져도
1개만 성공하면 조용히 넘어갔습니다. 그 구멍을 막았는지 확인합니다.

실행: python tests/test_fail_alert.py
※ 인터넷도 DB 도 필요 없습니다.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

FAIL_ALERT_RATIO = 0.10   # run_daily.py 와 같은 값 (아래에서 실제 값과 대조합니다)

failures: list[str] = []


def check(name: str, got, want) -> None:
    if got == want:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}\n       나온 값: {got!r}\n       기대 값: {want!r}")
        failures.append(name)


def verdict(total: int, ok: int) -> int:
    """run_daily.py 끝부분의 판단을 그대로 옮긴 것"""
    failed = total - ok
    if ok == 0:
        return 1
    if failed and failed / total > FAIL_ALERT_RATIO:
        return 1
    return 0


print("=" * 60)
print("  수집 실행의 성공/실패 판단")
print("=" * 60)

print("\n[1] 대표님이 연락을 받아야 하는 경우 (실패로 표시)")
check("208개 중 전부 실패", verdict(208, 0), 1)
check("91개 중 90개 실패 (예전엔 조용히 넘어갔음)", verdict(91, 1), 1)
check("208개 중 절반 실패", verdict(208, 104), 1)
check("208개 중 21개 실패 (10% 초과)", verdict(208, 187), 1)

print("\n[2] 연락받을 필요 없는 경우 (성공으로 표시)")
check("208개 전부 성공", verdict(208, 208), 0)
check("208개 중 1개 실패 (일시적 통신 오류)", verdict(208, 207), 0)
check("208개 중 20개 실패 (딱 10%, 기준 이내)", verdict(208, 188), 0)

print("\n[3] 분야가 몇 개 없는 서점에서도 동작하는지")
check("3개 중 1개 실패", verdict(3, 2), 1)
check("3개 전부 성공", verdict(3, 3), 0)
check("1개뿐인데 실패", verdict(1, 0), 1)

print("\n[4] 시험에 적은 기준값이 실제 코드와 같은지")
# 시험만 통과하고 실제 코드는 다른 값을 쓰는 상황을 막습니다
import re                                                    # noqa: E402
src = (ROOT / "crawler" / "run_daily.py").read_text()
m = re.search(r"^FAIL_ALERT_RATIO\s*=\s*([\d.]+)", src, re.M)
check("run_daily.py 의 FAIL_ALERT_RATIO 와 일치",
      float(m.group(1)) if m else None, FAIL_ALERT_RATIO)

print("\n" + "=" * 60)
if failures:
    print(f"  ❌ 실패 {len(failures)}건: {', '.join(failures)}")
    raise SystemExit(1)
print("  ✅ 전부 통과")
raise SystemExit(0)
