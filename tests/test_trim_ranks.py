"""
기준 밖 순위 정리(crawler/trim_ranks.py) 규칙 시험.

【왜 이 시험이 꼭 필요한가요? — 2026-08-11】
이 프로그램은 **되돌릴 수 없게 지웁니다.** 그리고 가장 위험한 것은
용량이 아니라 대표님이 손으로 내리신 8만 5천 건의 결정입니다.

    book_matches 는 store_books 에 ON DELETE CASCADE 로 걸려 있습니다.
    상품 한 줄을 지우면 데이터베이스가 그 상품에 걸린 결정을
    **말없이 함께 지웁니다.**

manual_merge 38,161 + manual_split 47,054 이 한순간에 사라질 수 있고,
사라져도 화면은 멀쩡해 보입니다. 그래서 기계가 지킵니다.

또 하나. 몇 위까지 남길지를 **데이터베이스의 categories.max_items 에서
읽으면 안 됩니다.** 그 값은 수집이 돌 때 맞춰지는데, 아직 안 돌았으면
옛 값(1000)이 남아 있습니다. 그걸 믿으면 아무것도 안 지우고
'성공' 이라고 말하게 됩니다. 설정 파일에서 읽는지 확인합니다.

실행: python tests/test_trim_ranks.py
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

from trim_ranks import (  # noqa: E402
    FALLBACK, FALLBACK_DEFAULT, cap_for, caps_from_config,
)

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


STORE = {1: "kyobo", 2: "yes24", 3: "aladin"}

print("\n[1] 설정 파일에서 기준을 읽는다 (DB 값이 아니라)")
caps = caps_from_config()
check("분야를 읽어낸다", len(caps) > 100, len(caps))

daily = [v for (s, k, c), v in caps.items() if k != "weekly"]
weekly = [v for (s, k, c), v in caps.items() if k == "weekly"]
check(f"일간은 전부 300 이하 ({len(daily)}개)", daily and max(daily) <= 300, max(daily or [0]))
check(f"주간은 전부 500 이하 ({len(weekly)}개)", weekly and max(weekly) <= 500,
      max(weekly or [0]))
# 🚨 1000 이 하나라도 남아 있으면 config 수정이 덜 된 것입니다.
check("1000 위짜리가 하나도 안 남았다", 1000 not in caps.values())

print("\n[2] 🚨 데이터베이스의 옛 값에 속지 않는다")
# categories.max_items 가 아직 1000 이어도 설정 파일 값을 씁니다.
# 여기서 1000 을 쓰면 아무것도 안 지우고 '성공' 이라고 말하게 됩니다.
kyobo_all = {"store_id": 1, "kind": "online", "code": "", "max_items": 1000}
got = cap_for(kyobo_all, caps, STORE)
check("교보 일간 전체 → 300 (DB 의 1000 을 무시)", got == 300, got)

yes_weekly = {"store_id": 2, "kind": "weekly", "code": "001", "max_items": 1000}
got = cap_for(yes_weekly, caps, STORE)
check("예스24 주간 전체 → 500 (DB 의 1000 을 무시)", got == 500, got)

print("\n[3] 설정에 없는 분야도 안전하게 다룬다")
# 서점이 없앤 옛 분야가 DB 에 남아 있을 수 있습니다.
# 여기서 기준을 못 정하면 지우지 말아야 할 것을 지우거나, 그 반대가 됩니다.
gone_daily = {"store_id": 1, "kind": "online", "code": "없는코드", "max_items": 1000}
check(f"모르는 일간 분야 → {FALLBACK_DEFAULT}",
      cap_for(gone_daily, caps, STORE) == FALLBACK_DEFAULT,
      cap_for(gone_daily, caps, STORE))
gone_weekly = {"store_id": 3, "kind": "weekly", "code": "없는코드"}
check(f"모르는 주간 분야 → {FALLBACK['weekly']}",
      cap_for(gone_weekly, caps, STORE) == FALLBACK["weekly"],
      cap_for(gone_weekly, caps, STORE))
check("서점을 몰라도 안 터진다", cap_for({"store_id": 99, "kind": "online"}, caps, STORE) > 0)
check("빈 값에도 안 터진다", cap_for({}, caps, STORE) > 0)

print("\n[4] 🚨 대표님 결정을 지키는 규칙이 코드에 살아 있는가")
# 이 부분은 실제로 DB 를 지우는 자리라 여기서 돌려 볼 수 없습니다.
# 대신 규칙이 사라지지 않았는지 글자로 지킵니다. 누가 '간단히 하려고'
# 이 조건을 빼면, 대표님 검토 8만 5천 건이 조용히 사라집니다.
src = (ROOT / "crawler" / "trim_ranks.py").read_text(encoding="utf-8")
check("결정이 걸린 상품을 찾아낸다",
      'in_("decision", ["manual_merge", "manual_split"])' in src)
check("양쪽 칸(a·b)을 모두 본다",
      'for col in ("store_book_a", "store_book_b")' in src)
check("찾아낸 것을 지울 목록에서 뺀다", "i not in locked" in src)
check("시작할 때 건수를 센다", "before = " in src)
check("끝날 때 다시 세어 비교한다", "after == before" in src)
check("줄었으면 실패로 끝낸다", "return 1" in src)

print("\n[5] 🚨 확인만 했을 때 숫자가 진짜와 같은가 (2026-08-11 실제 사고)")
# 대표님께 "지울 상품 19,717개" 라고 알려 드리고 승인을 받았는데,
# 진짜로 돌리니 80,411개였습니다. **4배 틀린 숫자로 승인을 받은 것**입니다.
#
# 원인: 확인만 할 때는 ① 이 순위를 안 지웁니다. 그런데 ② 는 '순위가
#      한 줄도 없는 상품' 을 세므로, ① 이 지웠을 줄이 아직 남아 있어
#      멀쩡한 상품처럼 보였습니다.
#
# 고친 뒤에는 ② 가 '① 이 지웠을 상태' 를 흉내 내서 셉니다.
check("분야별 기준을 미리 모아 둔다", "cap_by_cat" in src)
check("순위를 셀 때 등수도 함께 읽는다",
      'select("store_book_id,category_id,rank")' in src)
check("🚨 확인만 할 때 기준 넘는 줄은 없는 셈 친다",
      'if not dry or r["rank"] <= cap_by_cat' in src)

print("\n[6] 확인만 하는 길(dry run)이 있는가")
# 되돌릴 수 없는 작업이라, 먼저 보고 나서 지울 수 있어야 합니다.
check("DRY_RUN 을 읽는다", 'os.environ.get("DRY_RUN"' in src)
check("dry 면 순위를 안 지운다", "if dry:\n            print" in src or "if dry:" in src)
check("dry 면 상품도 안 지운다", "if not dry:" in src)

print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    for f in failures:
        print(f"   · {f}")
    raise SystemExit(1)
print("✅ 모두 통과")
