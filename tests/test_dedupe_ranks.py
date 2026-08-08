"""
순위 겹침 정리 규칙이 제대로 동작하는지 확인하는 시험.

실행: python tests/test_dedupe_ranks.py
※ 인터넷도 DB 도 필요 없습니다. 순수 계산만 확인합니다.

【왜 이 시험이 있나요? — 2026-08-08 실제 사고】
예스24 목록이 1,000권보다 짧은 분야에서 뒤쪽 페이지를 요청했더니,
앞 페이지에 있던 순위 번호를 단 '다른 책' 이 섞여 나왔습니다.
한 분야에 15위가 두 권이 되니 데이터베이스가 저장을 거부했고
(중복 키 오류), 그 분야가 통째로 0권 실패가 됐습니다. 10개 분야가 날아갔습니다.

같은 일이 다시 생기지 않도록 규칙을 시험으로 못박아 둡니다.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

from run_daily import dedupe_ranks, is_recycled_page  # noqa: E402

failures: list[str] = []


def check(name: str, got, want) -> None:
    if got == want:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}\n       나온 값: {got!r}\n       기대 값: {want!r}")
        failures.append(name)


def check_raises(name: str, fn, expect_in: str) -> None:
    try:
        fn()
    except RuntimeError as exc:
        if expect_in in str(exc):
            print(f"  ✅ {name}")
            return
        print(f"  ❌ {name}\n       다른 오류: {exc}")
    else:
        print(f"  ❌ {name}\n       오류가 나야 하는데 그냥 통과했습니다")
    failures.append(name)


@dataclass
class Row:
    """수집 결과 한 줄 흉내. 이 규칙은 rank 만 봅니다."""

    rank: int
    store_book_key: str


def rows(*ranks: int) -> list[Row]:
    return [Row(rank=r, store_book_key=f"k{i}") for i, r in enumerate(ranks)]


print("=" * 60)
print("  순위 겹침 정리 규칙 시험")
print("=" * 60)

print("\n[1] 겹치는 순위가 없으면 그대로 둔다")
got = dedupe_ranks(rows(1, 2, 3, 4, 5), "테스트")
check("5권 그대로", [r.rank for r in got], [1, 2, 3, 4, 5])

print("\n[2] 겹치면 '먼저 나온 쪽'(앞 페이지)을 남긴다")
# 30권 중 1권만 겹치게 둡니다. 많이 겹치면 '남기기' 가 아니라 '실패' 가 정답입니다.
got = dedupe_ranks(rows(*range(1, 31), 2), "테스트")
check("겹친 1권이 빠진다", [r.rank for r in got], list(range(1, 31)))
check("나중 것이 아니라 먼저 온 것이 남는다", got[1].store_book_key, "k1")

print("\n[3] 조금 겹치는 정도(1%)는 빼고 계속 진행한다")
got = dedupe_ranks(rows(*range(1, 101), 50), "테스트")
check("100권이 남는다", len(got), 100)

print("\n[4] 많이 겹치면(20%) 자료를 믿을 수 없다고 보고 실패시킨다")
check_raises(
    "20% 겹치면 예외",
    lambda: dedupe_ranks(rows(*range(1, 17), 1, 2, 3, 4), "테스트"),
    "순위가 겹친 도서가 너무 많습니다",
)

print("\n[5] 빈 목록도 터지지 않는다")
check("빈 목록", dedupe_ranks([], "테스트"), [])

print("\n[6] '앞 내용의 재탕' 페이지를 알아본다")
# 목록의 끝을 지나면 서점이 앞 페이지 순위를 다시 돌려줍니다.
# 그 페이지는 쓰지 않고 거기서 멈춰야 합니다.
seen = set(range(1, 601))            # 1~600위는 이미 받았음
check("정상 페이지(601~620위)는 재탕이 아니다",
      is_recycled_page(rows(*range(601, 621)), seen), False)
check("절반이 이미 나온 순위면 재탕이다",
      is_recycled_page(rows(*range(1, 11), *range(601, 611)), seen), True)
check("한두 권만 겹치는 건 재탕이 아니다 (그 책만 빼면 됨)",
      is_recycled_page(rows(5, *range(601, 621)), seen), False)
check("빈 페이지는 재탕 판단 대상이 아니다",
      is_recycled_page([], seen), False)

print("\n" + "=" * 60)
if failures:
    print(f"  ❌ 실패 {len(failures)}건: {', '.join(failures)}")
    raise SystemExit(1)
print("  ✅ 순위 겹침 정리 규칙 시험 전부 통과")
raise SystemExit(0)
