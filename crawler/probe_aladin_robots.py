"""
=============================================================================
 알라딘 robots.txt 원문 확인 — 2026-10-20
=============================================================================

 [매일 수집] 이 이렇게 멈췄습니다.

   🚫 aladin: robots.txt 가 수집을 금지합니다
      — `User-Agent: *` 그룹의 `Disallow: /` 적용

 8월 28일에 대표님이 보내 주신 알라딘 robots.txt 는 `User-agent: *` 가
 `Allow: /` 였습니다. 그래서 둘 중 하나입니다.

   ㉮ 알라딘이 robots.txt 를 바꿨다  → 우리는 수집을 멈춰야 합니다
   ㉯ 우리 파서가 엉뚱한 그룹을 읽었다 → 멀쩡한 서점을 잃고 있는 것입니다

 ㉯ 라면 제 버그 때문에 서점 하나를 통째로 버리는 것이므로, 추측하지 않고
 **원문을 그대로 눈으로 봅니다.**

 ※ 요청 1건 (robots.txt 만). 목록·상세 페이지 진입 없음. DB 안 건드림.
 실행: Actions → [알라딘 robots 원문] → Run workflow
=============================================================================
"""

from __future__ import annotations

import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import robots as robots_mod  # noqa: E402

UA = "BestsellerTracker/1.0 (+https://github.com/choimog/apple)"
ROBOTS = "https://www.aladin.co.kr/robots.txt"

# 수집기가 실제로 받으려는 주소 두 개 (일간 · 주간)
PATHS = (
    "https://www.aladin.co.kr/shop/common/wbest.aspx"
    "?BestType=DailyBest&BranchType=1&CID=0&page=1",
    "https://www.aladin.co.kr/shop/common/wbest.aspx"
    "?BestType=Bestseller&BranchType=1&CID=0&page=1",
)


def main() -> int:
    print("=" * 66)
    print("  알라딘 robots.txt 원문")
    print("=" * 66)

    with httpx.Client(timeout=20.0, follow_redirects=True) as c:
        r = c.get(ROBOTS, headers={"User-Agent": UA})

    print(f"  HTTP {r.status_code}  ·  {len(r.text):,} 글자")
    print()
    if r.status_code != 200:
        # 🚨 403 은 '규칙 없음' 이 아닙니다. 지금 코드는 그렇게 읽습니다.
        print("  🚨 robots.txt 를 못 받았습니다. 지금 수집기는 이것을")
        print("     '제한 없음' 으로 읽고 수집을 시도합니다.")
        return 1

    print("─" * 66)
    print(r.text)
    print("─" * 66)
    print()

    rules = robots_mod.parse(r.text)
    print(f"  파서가 읽은 그룹 수: {len(rules.groups)}")
    for g in rules.groups:
        print(f"    · User-agent: {', '.join(g.agents)}")
        for d in g.disallows:
            print(f"        Disallow: {d}")
        for a in g.allows:
            print(f"        Allow: {a}")
    print()

    chosen = rules.group_for(UA)
    print(f"  🚨 우리에게 적용되는 그룹: "
          f"{', '.join(chosen.agents) if chosen else '(없음)'}")
    print(f"     (우리 이름표: {UA})")
    print()

    for p in PATHS:
        ok, why = rules.is_allowed(p, UA)
        print(f"  {'✅ 허용' if ok else '🚫 금지'}  {p}")
        print(f"       근거: {why}")
    print("=" * 66)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
