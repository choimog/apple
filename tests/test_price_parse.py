"""
🚨 이벤트 문구의 금액을 정가로 착각하지 않는지 봅니다.

【2026-08-12 — 대표님이 원인을 직접 찾아 주셨습니다】

    "문학동네의 긴긴밤이란 책이 예스랑 교보에는 12,500원으로 등록되어
     있고 알라딘엔 15,000원으로 등록되어 있어. 실제로 가보니 12,500원인데"

    "근데 알라딘을 보니까, 이런 이벤트 문구가 이벤트 도서 항목마다
     붙어있더라고.
       · 8월 특별 선물 … (이벤트 도서 포함 국내서·외서 5만원 이상)
       · 캐리어·백 리플렉터 택 세트 (대상도서 15,000원 이상)
     이런 이벤트의 가격들 중에서 숫자를 모두 기재한 경우, 문제가 되는
     것 같아."

정확한 진단이었습니다.

예스24는 정가 전용 이름표(em.yes_m)가 있어 그것만 콕 집어 읽습니다.
**알라딘·교보는 이름표가 없어 칸 글자를 통째로 훑고, 숫자 중 큰 값을
정가로 봅니다.** 그래서 이벤트 문구의 15,000 이 12,500 을 이겼습니다.

🚨 이건 한 권의 문제가 아닙니다.
   · 이벤트 도서이면서 정가가 그 금액보다 싼 책 **전부**가 틀립니다
   · 정가가 다르면 다른 책으로 갈라내므로 **알라딘만 안 묶이는 책**도
     생깁니다 (대표님이 보신 '안 묶임' 중 일부가 이것일 수 있습니다)

【두 겹으로 막습니다】
  ① 숫자 뒤에 '이상·이하…' 가 붙으면 값이 아니라 **조건**입니다
     숫자 앞에 '적립·쿠폰·배송…' 이 있어도 값이 아닙니다
  ② 서점이 이벤트 문구에 이름표를 달아 준 경우엔 그 덩어리를 통째로 뺍니다

실행: python tests/test_price_parse.py
※ 인터넷도 DB 도 필요 없습니다.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

from selectolax.parser import HTMLParser          # noqa: E402
from stores.base import parse_prices, price_text  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


print("\n[1] 🚨 대표님이 보내주신 실제 이벤트 문구")
REAL = [
    ("캐리어·백 리플렉터 택 세트 (대상도서 15,000원 이상)", 12500),
    ("8월 특별 선물. 원통형 가방 · 책 키링 카드지갑 "
     "(이벤트 도서 포함 국내서·외서 50,000원 이상)", 12500),
]
# 🚨 이벤트 문구가 **가격보다 먼저** 나올 때가 진짜 사고입니다.
#    parse_prices 는 찾은 숫자 중 앞의 둘만 쓰기 때문에,
#    이벤트 금액이 뒤에 오면 원래 안 걸립니다. 앞에 오면 정가를 밀어냅니다.
#      [15,000(이벤트) · 12,500 · 11,250] → 정가 15,000 · 판매가 12,500
#    대표님이 보신 값이 정확히 이 모양이었습니다.
for promo, want in REAL:
    for label, text in (
        ("가격 앞에",  f"긴긴밤 {promo} 12,500원 11,250원"),
        ("가격 뒤에",  f"긴긴밤 12,500원 11,250원 {promo}"),
    ):
        got, _ = parse_prices(text)
        check(f"{label} …{promo[-20:]} → 정가 {want:,}원", got == want, got)

print("\n[2] 값이 아닌 숫자를 거릅니다")
for label, text, want in [
    ("적립금", "긴긴밤 12,500원 적립 1,250원", 12500),
    ("무료배송 안내", "긴긴밤 12,500원 배송 15,000원 이상 무료", 12500),
    ("쿠폰", "긴긴밤 12,500원 쿠폰 20,000원 할인", 12500),
    ("마일리지", "긴긴밤 12,500원 마일리지 5,000원", 12500),
    ("이하 조건", "긴긴밤 12,500원 (30,000원 이하 대상)", 12500),
]:
    got, _ = parse_prices(text)
    check(f"{label} → {want:,}원", got == want, got)

print("\n[3] 🚨 멀쩡한 값까지 버리면 안 됩니다")
for label, text, want_list, want_sale in [
    ("정가만", "긴긴밤 12,500원", 12500, None),
    ("정가+판매가", "긴긴밤 12,500원 11,250원", 12500, 11250),
    ("비싼 책 + 이벤트 문구", "전집 180,000원 162,000원 (대상도서 15,000원 이상)",
     180000, 162000),
    ("이벤트 금액이 정가와 같아도", "책 15,000원 13,500원 (대상도서 15,000원 이상)",
     15000, 13500),
]:
    got_l, got_s = parse_prices(text)
    check(f"{label} → 정가 {want_list!r} · 판매가 {want_sale!r}",
          got_l == want_list and got_s == want_sale, (got_l, got_s))

print("\n[4] 두 번째 방어선 — 이벤트 덩어리를 통째로 뺍니다")
HTML = """
<div class="ss_book_box">
  <a class="bo3">긴긴밤</a>
  <span class="ss_ht1">캐리어·백 리플렉터 택 세트 (대상도서 99,000원 이상)</span>
  <a href="/events/wevent_redirect.aspx?eventid=1">8월 특별 선물 (88,000원 이상)</a>
  <span>12,500원</span> <span>11,250원</span>
</div>
"""
box = HTMLParser(HTML).css("div.ss_book_box")[0]
cleaned = price_text(box, ["span.ss_ht1", 'a[href*="/events/"]'])
check("이벤트 문구가 빠졌다", "99,000" not in cleaned and "88,000" not in cleaned,
      cleaned)
check("책 값은 남았다", "12,500" in cleaned and "11,250" in cleaned, cleaned)
got_l, got_s = parse_prices(cleaned)
check("정가 12,500 · 판매가 11,250", (got_l, got_s) == (12500, 11250), (got_l, got_s))

print("\n[5] 🚨 두 번째 방어선이 정말 필요한가 (겹치기만 하면 군더더기입니다)")
# ① 말 규칙(이상·적립…)만으로는 못 막는 문구가 있습니다.
#    이벤트 문구는 서점이 마음대로 씁니다. 말 목록은 언제나 뒷북입니다.
#    그래서 '이름표가 달린 덩어리는 통째로 뺀다' 는 두 번째 방어선이
#    따로 있어야 합니다. 아래가 그 증거입니다.
from stores.base import box_text  # noqa: E402

HARD = """
<div class="ss_book_box">
  <a class="bo3">긴긴밤</a>
  <span class="ss_ht1">한정판 굿즈 99,000원 상당</span>
  <span>12,500원</span> <span>11,250원</span>
</div>
"""
hard = HTMLParser(HARD).css("div.ss_book_box")[0]
only_words, _ = parse_prices(box_text(hard))
check("말 규칙만으로는 못 막는다 (99,000원 으로 틀림)", only_words == 99000,
      only_words)
both, _ = parse_prices(price_text(hard, ["span.ss_ht1"]))
check("🚨 덩어리를 빼면 막힌다 (12,500원)", both == 12500, both)

print("\n[6] 알라딘이 실제로 그것을 쓰는가")
A = (ROOT / "crawler" / "stores" / "aladin.py").read_text(encoding="utf-8")
check("알라딘이 price_text 를 쓴다", "price_text(box," in A,
      "box_text 를 그대로 쓰면 이벤트 문구가 다시 섞입니다")
check("이벤트 이름표와 이벤트 링크를 둘 다 뺀다",
      'selectors.get("event")' in A and "/events/" in A)

print("\n[7] 이상한 값이 와도 죽지 않는다")
for junk in (None, "", "글자만", "원", "12원"):
    try:
        got = parse_prices(junk)
        check(f"{junk!r} → 죽지 않는다", isinstance(got, tuple), got)
    except Exception as exc:      # noqa: BLE001
        check(f"{junk!r} → 죽지 않는다", False, repr(exc))

print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    for f in failures:
        print(f"   · {f}")
    raise SystemExit(1)
print("✅ 모두 통과")
