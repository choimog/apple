"""
정가·판매가를 읽는 규칙 시험.

【왜 이 시험이 생겼나요? — 2026-08-11, 실제로 사고가 났습니다】

교보 정가를 알라딘과 대조해 보니 이렇게 나왔습니다.

    교보문고: 2,918,000원  SQL 자격검정 실전문제
    알라딘  :    18,000원  SQL 자격검정 실전문제

    교보문고: 1,332,000원  스타팅 스트렝스
    알라딘  :    32,000원  스타팅 스트렝스

    교보문고:   157,000원  주택과 세금(2026)
    알라딘  :     7,000원  2026 주택과 세금

**앞의 두 자리 + 진짜 가격** 입니다. 29+18,000 / 13+32,000 / 15+7,000.
태그가 붙어 있으면 글자가 이어붙기 때문입니다.

    <span>29</span><span>18,000</span>원  →  "2918,000원"

이게 왜 심각하냐면, 지금 매칭 규칙은 **정가가 다르면 무조건 다른 책**
으로 갈라냅니다. 그래서 멀쩡한 짝이 매일 조용히 갈라졌습니다.
화면에는 아무 표시도 안 났습니다. 2,663쌍 중 132쌍(5%)이 어긋나 있었습니다.

이 시험은 그 사고를 그대로 재현해 두고, 다시는 못 지나가게 막습니다.

실행: python tests/test_prices.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

from selectolax.parser import HTMLParser  # noqa: E402

from stores.base import PRICE_MAX, box_text, parse_prices  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


def box(html: str):
    return HTMLParser(html).css_first("div")


print("\n[1] 🚨 태그가 붙어 있어도 숫자가 이어붙지 않는다 (실제 사고)")
# 이 세 줄이 2026-08-11 에 실제로 저장돼 있던 값입니다.
cases = [
    ("SQL 자격검정 실전문제", '<div><span>29</span><span>18,000</span>원</div>', 18000),
    ("스타팅 스트렝스", '<div><em>13</em><em>32,000</em>원</div>', 32000),
    ("주택과 세금(2026)", '<div><i>15</i><b>7,000</b>원</div>', 7000),
]
for title, html, want in cases:
    got, _ = parse_prices(box_text(box(html)))
    check(f"{title} → {want:,}원", got == want, got)

# 고치기 전에는 어떻게 됐는지도 못박아 둡니다.
# (누가 box_text 를 다시 box.text() 로 되돌리면 여기서 걸립니다)
old = box(cases[0][1]).text()
check("공백 없이 꺼내면 실제로 이어붙는다 (사고 재현)", old == "2918,000원", old)
check(
    "공백을 넣으면 안 이어붙는다",
    box_text(box(cases[0][1])) == "29 18,000 원",
    box_text(box(cases[0][1])),
)

print("\n[2] 🚨 있을 수 없는 값은 저장하지 않는다")
# 다른 서점에서 같은 일이 또 생겨도 틀린 값이 들어가지 않게 막는 그물입니다.
# 틀린 값을 저장하는 것보다 빈 값이 낫습니다.
huge, _ = parse_prices("2,918,000원")
check(f"{PRICE_MAX:,}원을 넘으면 버린다", huge is None, huge)
check("경계값(200만 원)은 받는다", parse_prices("2,000,000원")[0] == 2_000_000)
check("마일리지 같은 작은 값은 버린다", parse_prices("500원")[0] is None)

print("\n[3] 정가와 판매가를 제대로 가른다")
check("큰 쪽이 정가", parse_prices("22,000원 → 19,800원") == (22000, 19800),
      parse_prices("22,000원 → 19,800원"))
check("순서가 바뀌어도 큰 쪽이 정가",
      parse_prices("16,200원 18,000원") == (18000, 16200),
      parse_prices("16,200원 18,000원"))
check("하나뿐이면 정가로만 본다 (판매가를 지어내지 않는다)",
      parse_prices("18,000원") == (18000, None),
      parse_prices("18,000원"))
check("가격이 없으면 둘 다 없음", parse_prices("가격 문의") == (None, None))
check("빈 글자에도 안 터진다", parse_prices("") == (None, None))
check("None 에도 안 터진다", parse_prices(None) == (None, None))

print("\n[4] 알라딘 실제 화면으로 확인 (저장해 둔 목록 페이지)")
fx = ROOT / "tests" / "fixture_aladin_book.html"
if not fx.exists():
    check("알라딘 견본이 있다", False, str(fx))
else:
    node = HTMLParser(fx.read_text(encoding="utf-8")).css_first("div.ss_book_box")
    check("책 칸을 찾는다", node is not None)
    if node is not None:
        lp, sp = parse_prices(box_text(node))
        # 견본의 실제 값입니다. 서점 화면이 바뀌면 여기서 걸립니다.
        check(f"정가 22,000원 (나온 값 {lp})", lp == 22000, lp)
        check(f"판매가 19,800원 (나온 값 {sp})", sp == 19800, sp)
        # 🚨 공백을 안 넣던 예전 방식과 값이 같아야 합니다.
        #    (알라딘은 원래 잘 되던 곳이라 고치면서 망가지면 안 됩니다)
        check("고치기 전과 결과가 같다 (알라딘은 원래 멀쩡했음)",
              parse_prices(node.text())[0] == lp)

print("\n[5] 예스24 실제 화면 — 태그로 콕 집어 읽습니다")
# 예스24 는 정가·판매가에 따로 이름표(class)가 있어서 글자를 훑지 않습니다.
# 그래서 이어붙는 사고가 원래 안 납니다. 그 사실을 못박아 둡니다.
fy = ROOT / "tests" / "fixture_yes24_book.html"
if not fy.exists():
    check("예스24 견본이 있다", False, str(fy))
else:
    tree = HTMLParser(fy.read_text(encoding="utf-8"))
    unit = tree.css_first("div.itemUnit")
    check("책 칸을 찾는다", unit is not None)
    if unit is not None:
        sale = unit.css_first("div.info_price em.yes_b")
        lst = unit.css_first("div.info_price em.yes_m")
        check("판매가 자리를 찾는다", sale is not None)
        # 정가 자리는 할인이 없으면 아예 없습니다. 없어도 정상입니다.
        if lst is not None:
            got, _ = parse_prices(lst.text() + "원")
            check(f"정가를 읽는다 ({got})", got is not None and got >= 1000, got)

print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    for f in failures:
        print(f"   · {f}")
    raise SystemExit(1)
print("✅ 모두 통과")
