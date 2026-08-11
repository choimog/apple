"""
믿어도 되는지 확인하는 도구(crawler/probe_trust.py) 시험.

【왜 이 시험이 필요한가요? — 2026-08-11】
이 도구는 두 가지를 판정합니다.
  ① 알라딘 표지 이름이 진짜 ISBN 인가
  ② 교보 정가를 제대로 읽고 있는가

**판정 도구가 틀리면 틀린 것을 맞다고 통과시킵니다.** 그러면
엉뚱한 두 책이 영원히 한 권이 되거나, 멀쩡한 짝이 조용히 갈라집니다.
빈 값보다 훨씬 나쁩니다. 그래서 도구 자체를 먼저 시험합니다.

특히 지키는 경계:
  · 매칭이 묶어 놓은 무리(book_id)를 쓰지 않는다 — 스스로 채점 금지
  · 교보가 직접 알려준 ISBN 만 기준으로 삼는다
  · 맞대 볼 짝이 없으면 '통과' 가 아니라 '판정 불가' 라고 말한다

실행: python tests/test_probe_trust.py
"""

from __future__ import annotations

import io
import sys
import types
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

_fake = types.ModuleType("supabase")
_fake.Client = object
_fake.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _fake)

from probe_trust import check_cover_isbn, check_prices, isbn_of, sim  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


def run(fn, rows) -> str:
    buf = io.StringIO()
    with redirect_stdout(buf):
        fn(rows)
    return buf.getvalue()


# 진짜 ISBN 두 개 (검사식 통과)
A13 = "9788932917245"
A10 = "8932917248"          # 위와 같은 책의 10자리
B13 = "9791199489561"

KYOBO_COVER = f"https://contents.kyobobook.co.kr/sih/fit-in/300x0/pdt/{B13}.jpg"
ALADIN_COVER = f"https://image.aladin.co.kr/product/1/2/cover/{A10}_1.jpg"
YES_COVER = "https://image.yes24.com/goods/192474512/L"


def sb(**kw) -> dict:
    base = dict(id=0, store_id=1, raw_title="", norm_title="", isbn13=None,
                cover_url=None, list_price=None, book_id=None)
    base.update(kw)
    return base


print("\n[1] ISBN 을 어디서 가져오는가")
check("서점이 준 값을 그대로 쓴다",
      isbn_of(sb(isbn13=A13, cover_url=KYOBO_COVER)) == A13)
check("없으면 표지 주소에서 찾아낸다",
      isbn_of(sb(cover_url=ALADIN_COVER)) == A13, isbn_of(sb(cover_url=ALADIN_COVER)))
check("상품번호는 ISBN 으로 안 본다",
      isbn_of(sb(cover_url=YES_COVER)) is None, isbn_of(sb(cover_url=YES_COVER)))
check("아무것도 없으면 None", isbn_of(sb()) is None)

print("\n[2] 제목 닮은 정도")
check("같으면 1.0", sim("아버지의해방일지", "아버지의해방일지") == 1.0)
check("전혀 다르면 낮다", sim("아버지의해방일지", "총균쇠") < 0.4,
      sim("아버지의해방일지", "총균쇠"))
check("빈 값이면 0", sim(None, "가") == 0.0)

print("\n[3] ① 표지 ISBN 판정 — 맞는 경우")
rows_ok = [
    sb(id=1, store_id=1, isbn13=A13, raw_title="아버지의 해방일지",
       norm_title="아버지의해방일지"),
    sb(id=2, store_id=3, cover_url=ALADIN_COVER, raw_title="아버지의 해방일지",
       norm_title="아버지의해방일지"),
]
out = run(check_cover_isbn, rows_ok)
check("교보에서 같은 ISBN 을 찾아낸다", "같은 ISBN 이 있는 것 1권" in out, out[-400:])
check("제목이 닮으면 통과시킨다", "✅ 진짜 ISBN" in out, out[-400:])

print("\n[4] 🚨 ① 표지 ISBN 판정 — 틀린 경우 (가장 중요)")
# 검사식은 통과하지만 실제로는 다른 책 → 반드시 걸러내야 합니다.
rows_bad = [
    sb(id=1, store_id=1, isbn13=A13, raw_title="아버지의 해방일지",
       norm_title="아버지의해방일지"),
    sb(id=2, store_id=3, cover_url=ALADIN_COVER, raw_title="총, 균, 쇠",
       norm_title="총균쇠"),
]
out = run(check_cover_isbn, rows_bad)
check("제목이 안 닮으면 ❌ 로 막는다", "❌ ISBN 이 아닙니다" in out, out[-400:])
check("안 맞은 예시를 보여준다", "🚨 안 맞은 예시" in out, out[-400:])
check("맞다고 잘못 말하지 않는다", "✅ 진짜 ISBN" not in out, out[-400:])

print("\n[5] 🚨 ① 맞대 볼 짝이 없으면 '판정 불가' 라고 말한다")
# 여기서 '통과' 라고 하면, 확인 안 된 것을 확인했다고 믿게 됩니다.
rows_none = [
    sb(id=2, store_id=3, cover_url=ALADIN_COVER, raw_title="아무 책",
       norm_title="아무책"),
]
out = run(check_cover_isbn, rows_none)
check("판정할 수 없다고 말한다", "판정할 수 없습니다" in out, out[-300:])
check("통과라고 말하지 않는다", "✅ 진짜 ISBN" not in out, out[-300:])

print("\n[6] ② 정가 대조 — 서로 다르면 잡아낸다")
rows_price = [
    sb(id=1, store_id=1, isbn13=A13, raw_title="가", norm_title="가",
       list_price=19000),                       # 교보가 잘못 읽은 값
    sb(id=2, store_id=3, cover_url=ALADIN_COVER, raw_title="가", norm_title="가",
       list_price=22000),                       # 알라딘이 읽은 값
]
out = run(check_prices, rows_price)
check("교보↔알라딘 짝을 만들어낸다", "교보문고 ↔ 알라딘" in out, out[-500:])
check("안 맞는 것을 ❌ 로 표시한다", "❌" in out, out[-500:])
check("어떤 값이 달랐는지 보여준다", "19,000원" in out and "22,000원" in out, out[-500:])

print("\n[7] ② 정가 대조 — 같으면 통과")
rows_same = [
    sb(id=1, store_id=1, isbn13=A13, raw_title="가", norm_title="가",
       list_price=22000),
    sb(id=2, store_id=3, cover_url=ALADIN_COVER, raw_title="가", norm_title="가",
       list_price=22000),
]
out = run(check_prices, rows_same)
check("일치하면 ✅", "✅ 1쌍 중 1쌍 일치" in out, out[-500:])

print("\n[8] 🚨 ② 매칭이 묶어 놓은 무리를 쓰지 않는다 (스스로 채점 금지)")
# 같은 book_id 로 묶여 있어도, ISBN 이 없으면 맞대지 않아야 합니다.
# 묶음은 '정가가 다르면 갈라낸다' 로 만든 결과라 채점 근거가 못 됩니다.
rows_cluster = [
    sb(id=1, store_id=1, raw_title="가", norm_title="가", list_price=19000,
       book_id=77),
    sb(id=2, store_id=2, raw_title="가", norm_title="가", list_price=22000,
       book_id=77),
]
out = run(check_prices, rows_cluster)
check("ISBN 이 없으면 맞대지 않는다", "판정할 수 없습니다" in out, out[-400:])

print("\n[9] 빈 자료에도 안 터진다")
out = run(check_cover_isbn, [])
check("① 빈 목록", "판정할 수 없습니다" in out or "0권" in out, out[-200:])
out = run(check_prices, [])
check("② 빈 목록", "판정할 수 없습니다" in out, out[-200:])

print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    for f in failures:
        print(f"   · {f}")
    raise SystemExit(1)
print("✅ 모두 통과")
