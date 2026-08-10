"""
매칭 규칙이 문서(docs/matching-rules.md)대로 동작하는지 확인하는 시험.

실행: python tests/test_match.py
※ 인터넷도 DB 도 필요 없습니다. 순수 계산만 확인합니다.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

from common import config as cfg          # noqa: E402
from common import normalize as norm      # noqa: E402
from common.match import Candidate, compare, compare_with_isbn, similarity  # noqa: E402

CFG = cfg.load("matching.yaml")
EDITIONS = CFG["edition_words"]
ROLES = CFG["role_words"]
PUBS = CFG["publisher_words"]
CANONICAL = CFG.get("edition_canonical") or {}

failures: list[str] = []


def check(name: str, got, want) -> None:
    if got == want:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}\n       나온 값: {got!r}\n       기대 값: {want!r}")
        failures.append(name)


def make(store_id: int, title: str, author: str | None,
         publisher: str | None, pub_ym: str | None,
         isbn13: str | None = None, sb_id: int = 0) -> Candidate:
    """서점이 보여준 원본 표기로부터 비교용 후보를 만듭니다."""
    t = norm.normalize_title(title, EDITIONS, CANONICAL)
    return Candidate(
        id=sb_id or store_id,
        store_id=store_id,
        norm_title=t["core"],
        norm_author=norm.normalize_author(author, ROLES),
        norm_publisher=norm.normalize_publisher(publisher, PUBS),
        pub_ym=pub_ym,
        isbn13=isbn13,
        edition_tags=t["editions"],
        set_volumes=t["set_volumes"],
    )


print("\n[1] 표기 통일(정규화)")
t = norm.normalize_title("달러구트 꿈 백화점 - 주문하신 꿈은 매진입니다", EDITIONS, CANONICAL)
check("부제를 떼어낸다", t["core"], "달러구트꿈백화점")
check("부제를 따로 보관한다", t["subtitle"], "주문하신 꿈은 매진입니다")

t2 = norm.normalize_title("달러구트 꿈 백화점 (양장본)", EDITIONS, CANONICAL)
check("괄호 속 판형을 떼어낸다", t2["core"], "달러구트꿈백화점")
check("판형을 표시로 남긴다", t2["editions"], ["양장본"])

t2b = norm.normalize_title("달러구트 꿈 백화점 (양장)", EDITIONS, CANONICAL)
check("'양장' 과 '양장본' 을 같은 표기로 본다", t2b["editions"], t2["editions"])

t3 = norm.normalize_title("해리 포터 세트 (전7권)", EDITIONS, CANONICAL)
check("세트 권수를 읽는다", t3["set_volumes"], 7)

check("저자 역할어를 뗀다",
      norm.normalize_author("히가시노 게이고 (지은이)", ROLES), "히가시노게이고")
check("출판사 표기를 뗀다",
      norm.normalize_publisher("(주)문학동네", PUBS), "문학동네")


print("\n[2] 닮은 정도 계산")
check("완전히 같으면 1.0", similarity("달러구트꿈백화점", "달러구트꿈백화점"), 1.0)
check("한쪽이 비면 0.0", similarity("달러구트꿈백화점", None), 0.0)
sim = similarity("달러구트꿈백화점", "아버지의해방일지")
print(f"  ℹ️ 전혀 다른 제목의 닮은 정도: {sim:.3f}")
check("전혀 다르면 기준선 미만", sim < CFG["thresholds"]["title_hard_floor"], True)


print("\n[3] 예시 A — 묶여야 하는 경우 (문서 6절)")
a = make(2, "달러구트 꿈 백화점", "이미예 저", "팩토리나인", "2020-07", sb_id=101)
b = make(3, "달러구트 꿈 백화점 - 주문하신 꿈은 매진입니다",
         "이미예 (지은이)", "팩토리나인", "2020-07", sb_id=102)
r = compare(a, b, CFG)
print(f"  ℹ️ 점수 {r.score}점 · 근거 {r.reasons}")
check("자동 병합된다", r.decision, "auto_high")


print("\n[4] 예시 B — 판형이 달라 안 묶이는 경우 (문서 6절)")
a = make(1, "달러구트 꿈 백화점 (양장본)", "이미예", "팩토리나인", "2020-07", sb_id=201)
b = make(3, "달러구트 꿈 백화점", "이미예 (지은이)", "팩토리나인", "2020-07", sb_id=202)
r = compare(a, b, CFG)
check("다른 책으로 판정", r.decision, "rejected")
check("이유가 판형 차이", r.reasons["rejected_by"], "에디션 표기가 다름")


print("\n[5] 예시 C — 출판사를 한쪽만 알 때 (문서 6절)")
# 【2026-08-08 규칙이 바뀌었습니다】
# 예전에는 80점으로 '검토 대기(auto_low)' 묶음이었습니다.
# 지금은 출판사를 한쪽이라도 모르면 더 엄격한 기준(85점)을 요구합니다.
# '모른다' 와 '같다' 는 다르기 때문입니다. 출판사가 비어 있다는 이유로
# 다른 출판사의 같은 원작이 뭉치면 안 됩니다.
# → 실제로 갈라지는 게 눈에 띄면 config/matching.yaml 의
#   publisher_unknown_needs_high 를 false 로 바꾸면 예전 동작이 됩니다.
a = make(2, "아버지의 해방일지", "정지아 저", "창비", "2022-09", sb_id=301)
b = make(3, "아버지의 해방일지", "정지아 (지은이)", None, "2022-10", sb_id=302)
r = compare(a, b, CFG)
print(f"  ℹ️ 점수 {r.score}점 · 근거 {r.reasons}")
check("출판사를 모르면 80점으로는 안 묶인다", r.decision, "rejected")

# 출판사가 양쪽에 다 있으면 예전처럼 검토 대기로 묶입니다
a = make(2, "아버지의 해방일지", "정지아 저", "창비", "2022-09", sb_id=303)
b = make(3, "아버지의 해방일지", "정지아 (지은이)", "창비", "2022-10", sb_id=304)
r = compare(a, b, CFG)
check("출판사가 같으면 묶인다", r.decision in ("auto_high", "auto_low"), True)
check("출판사가 같다고 기록된다", r.reasons["publisher"], "exact")


print("\n[6] 절대 묶으면 안 되는 경우들")
a = make(3, "달러구트 꿈 백화점", "이미예", "팩토리나인", "2020-07", sb_id=401)
b = make(3, "달러구트 꿈 백화점", "이미예", "팩토리나인", "2020-07", sb_id=402)
check("같은 서점 안의 두 상품", compare(a, b, CFG).reasons["rejected_by"],
      "같은 서점 안의 두 상품")

a = make(2, "해리 포터 세트 (전7권)", "조앤 K. 롤링", "문학수첩", "2019-11", sb_id=411)
b = make(3, "해리 포터", "조앤 K. 롤링 (지은이)", "문학수첩", "2019-11", sb_id=412)
check("세트와 단권", compare(a, b, CFG).reasons["rejected_by"], "세트 권수가 다름")

a = make(2, "아버지의 해방일지", "정지아", "창비", "2022-09", sb_id=421)
b = make(3, "달러구트 꿈 백화점", "정지아", "창비", "2022-09", sb_id=422)
check("제목이 너무 다름", compare(a, b, CFG).reasons["rejected_by"], "제목이 너무 다름")


print("\n[7] ISBN 이 양쪽에 있을 때 (교보 표지 주소에서 얻어지는 경우)")
a = make(1, "세네카, 오늘을 빼앗기고 있는 당신에게", "세네카", "논픽션", "2026-07",
         isbn13="9791199489561", sb_id=501)
b = make(2, "세네카 오늘을 빼앗기고 있는 당신에게", "루키우스 안나이우스 세네카 저",
         "논픽션", "2026-07", isbn13="9791199489561", sb_id=502)
check("ISBN 이 같으면 100점 확정", compare_with_isbn(a, b, CFG).score, 100)

b.isbn13 = "9788901234567"
check("ISBN 이 다르면 거부",
      compare_with_isbn(a, b, CFG).reasons["rejected_by"], "ISBN13 이 다름")

b.isbn13 = None
check("한쪽만 있으면 ISBN 판정 안 함", compare_with_isbn(a, b, CFG), None)


print("\n[8] 값이 없을 때 추정하지 않는다")
a = make(2, "어떤 책", None, None, None, sb_id=601)
b = make(3, "어떤 책", None, None, None, sb_id=602)
r = compare(a, b, CFG)
print(f"  ℹ️ 제목만 같을 때 점수: {r.score}점 (제목 배점 {CFG['weights']['title']}점)")
check("제목 배점만 받는다", r.score, CFG["weights"]["title"])
check("빈 값을 맞다고 치지 않는다",
      (r.reasons["author"], r.reasons["publisher"], r.reasons["pub_ym"]),
      ("missing", "missing", "missing"))
check("따라서 자동 병합되지 않는다", r.decision, "rejected")


print("\n[9] 출판사가 다르면 제목·저자가 같아도 다른 책이다")
# 【2026-08-08 대표님 지적】
# 민음사·서정시학·다산북스·문학동네의 '싯다르타' 가 한 권으로 뭉쳐 있었습니다.
# 같은 원작이어도 판권·번역·정가가 다른 별개의 상품입니다.
# 예전에는 제목 50 + 저자 25 = 75점이 묶는 기준(65점)을 넘어 버렸습니다.
for pub_b in ["문학동네", "서정시학", "다산북스", "열린책들"]:
    a = make(2, "싯다르타", "헤르만 헤세", "민음사", None, sb_id=900)
    b = make(3, "싯다르타", "헤르만 헤세", pub_b, None, sb_id=901)
    r = compare(a, b, CFG)
    check(f"민음사 vs {pub_b} 는 안 묶인다", r.decision, "rejected")

# 출간월까지 같아도(예전 85점 = 자동병합) 갈라져야 합니다
a = make(2, "싯다르타", "헤르만 헤세", "민음사", "2023-05", sb_id=902)
b = make(3, "싯다르타", "헤르만 헤세", "다산북스", "2023-05", sb_id=903)
r = compare(a, b, CFG)
check("출간월이 같아도 출판사가 다르면 안 묶인다", r.decision, "rejected")
check("거부 사유가 출판사로 기록된다", r.reasons.get("rejected_by"), "출판사가 다름")

print("\n[9-1] 출간월(배본일)이 다르면 아예 다른 책 — 2026-08-09 대표님 지시")
# 【왜 즉시 거부인가요?】
# 예전에는 출간월을 10점짜리 가산점으로만 봤습니다. 그래서
#   제목 50 + 저자 25 = 75점 → 묶는 기준(65점)을 넘어 버립니다.
# 출간월이 몇 년 차이 나도 묶였다는 뜻입니다.
# 개정판·재출간은 판권과 내용이 다른 별개의 상품입니다.
same = dict(author="헤르만 헤세", publisher="민음사")
a = make(1, "데미안", same["author"], same["publisher"], "2020-01")
b = make(2, "데미안", same["author"], same["publisher"], "2024-06")
check("4년 차이는 다른 책", compare(a, b, CFG).decision, "rejected")
check("이유를 적어 둔다",
      compare(a, b, CFG).reasons.get("rejected_by"), "출간월(배본일)이 다름")

# ⚠️ 한 달 차이까지 갈라놓으면 안 됩니다. 서점마다 배본일 기준이 다릅니다
#    (인쇄일/출고일/판매일). 같은 책도 한 달씩 어긋나게 적힙니다.
c = make(2, "데미안", same["author"], same["publisher"], "2020-02")
check("한 달 차이는 같은 책", compare(a, c, CFG).is_same_book, True)
d = make(2, "데미안", same["author"], same["publisher"], "2020-01")
check("같은 달은 당연히 같은 책", compare(a, d, CFG).is_same_book, True)
e = make(2, "데미안", same["author"], same["publisher"], "2020-03")
check("두 달 차이는 다른 책", compare(a, e, CFG).decision, "rejected")

# 🚨 '모른다' 를 '다르다' 로 바꾸면 값이 빈 서점의 책이 전부 갈라집니다.
none_ym = make(2, "데미안", same["author"], same["publisher"], None)
check("한쪽이 출간월을 모르면 거부하지 않는다",
      compare(a, none_ym, CFG).decision != "rejected", True)
both_none = make(1, "데미안", same["author"], same["publisher"], None)
check("양쪽 다 모르면 거부하지 않는다",
      compare(both_none, none_ym, CFG).decision != "rejected", True)

# 점수로는 절대 못 뒤집습니다 (제목·저자·출판사가 완전히 같아도)
check("완전히 같은 나머지 + 다른 출간월 → 그래도 거부",
      compare(a, b, CFG).decision, "rejected")

# 끌 수 있어야 합니다 (설정 한 줄)
import copy  # noqa: E402
off = copy.deepcopy(CFG)
off["thresholds"]["pub_ym_hard"] = False
check("pub_ym_hard: false 면 예전처럼 점수로만 본다",
      compare(a, b, off).decision != "rejected", True)


print("\n[10] 표기만 다른 같은 출판사는 그대로 묶인다")
for pub_b in ["(주)민음사", "민음사(주)", "주식회사 민음사"]:
    a = make(2, "싯다르타", "헤르만 헤세", "민음사", "2023-05", sb_id=910)
    b = make(3, "싯다르타", "헤르만 헤세", pub_b, "2023-05", sb_id=911)
    r = compare(a, b, CFG)
    check(f"민음사 vs {pub_b} 는 묶인다", r.decision in ("auto_high", "auto_low"), True)

print("\n[11] 출판사를 모를 때는 더 엄격하게 본다")
# 한쪽 출판사를 모르면 '다르지 않다' 고 말할 수 없습니다.
# 제목·저자만 같은 75점으로는 묶지 않고, 출간월까지 같은 85점을 요구합니다.
a = make(2, "싯다르타", "헤르만 헤세", "민음사", None, sb_id=920)
b = make(3, "싯다르타", "헤르만 헤세", None, None, sb_id=921)
r = compare(a, b, CFG)
check("출판사 모름 + 75점 → 안 묶임", r.decision, "rejected")

a = make(2, "싯다르타", "헤르만 헤세", "민음사", "2023-05", sb_id=922)
b = make(3, "싯다르타", "헤르만 헤세", None, "2023-05", sb_id=923)
r = compare(a, b, CFG)
check("출판사 모름 + 85점 → 묶임", r.decision, "auto_high")


print("\n[12] 다른 책을 다리 삼아 출판사가 섞이는 것도 막는다")
# 【왜 이 시험이 필요한가요? — 2026-08-08】
# "출판사가 다르면 안 묶는다" 는 두 권씩 비교할 때만 적용됩니다.
# 그런데 무리를 만들 때는 이어진 것을 계속 따라가기 때문에,
#   민음사 ─ (출판사 안 적힌 책) ─ 문학동네
# 처럼 가운데를 거쳐 간접적으로 한 무리가 될 수 있습니다.
# 그래서 무리를 다 만든 뒤 마지막으로 한 번 더 갈라냅니다.
import types as _types                                   # noqa: E402
_fake = _types.ModuleType("supabase")                     # DB 없이 불러오기 위함
_fake.Client = object
_fake.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _fake)
from run_match import split_by_publisher                  # noqa: E402

FLOOR = CFG["thresholds"].get("publisher_hard_floor", 0.80)


def sb(i: int, store_id: int, publisher: str | None) -> dict:
    return {"id": i, "store_id": store_id,
            "norm_publisher": norm.normalize_publisher(publisher, PUBS)}


# 민음사(1) ─ 출판사모름(2) ─ 문학동네(3) 이 한 무리가 된 상황
by_id = {1: sb(1, 1, "민음사"), 2: sb(2, 2, None), 3: sb(3, 3, "문학동네")}
pair = {(1, 2): 88.0, (2, 3): 86.0}
parts = split_by_publisher([1, 2, 3], by_id, pair, FLOOR)
check("민음사와 문학동네가 갈라진다", len(parts), 2)
check("출판사 모르는 책은 점수가 높았던 쪽(민음사)에 붙는다",
      sorted(sorted(p) for p in parts), [[1, 2], [3]])

# 같은 출판사를 다르게 적은 것은 갈라지면 안 됩니다
by_id2 = {1: sb(1, 1, "민음사"), 2: sb(2, 2, "(주)민음사"), 3: sb(3, 3, "민음사")}
parts2 = split_by_publisher([1, 2, 3], by_id2, {}, FLOOR)
check("표기만 다른 같은 출판사는 안 갈라진다", len(parts2), 1)

# 출판사를 전부 모르면 건드리지 않습니다 (근거 없이 쪼개지 않음)
by_id3 = {1: sb(1, 1, None), 2: sb(2, 2, None)}
parts3 = split_by_publisher([1, 2], by_id3, {}, FLOOR)
check("전부 출판사를 모르면 그대로 둔다", len(parts3), 1)

# 대표님이 지적하신 그대로: 출판사 4곳의 싯다르타
by_id4 = {i: sb(i, i, p) for i, p in enumerate(
    ["민음사", "서정시학", "다산북스", "문학동네"], start=1)}
parts4 = split_by_publisher([1, 2, 3, 4], by_id4, {}, FLOOR)
check("출판사 4곳의 싯다르타는 4권으로 갈라진다", len(parts4), 4)


# 큰 무리에서도 빨라야 합니다.
# 【2026-08-08】 책을 두 권씩 전부 비교하면 한 무리가 커질수록 급격히
# 느려집니다. 지금은 '출판사 이름' 끼리만 비교하므로 무리가 커져도
# 느려지지 않습니다. 이 시험이 그것을 지켜 줍니다.
import time as _time                                      # noqa: E402
big = {}
for i in range(1, 801):
    big[i] = sb(i, (i % 3) + 1, "민음사" if i % 2 else "문학동네")
_t = _time.monotonic()
big_parts = split_by_publisher(list(big), big, {}, FLOOR)
_elapsed = _time.monotonic() - _t
check("800권 무리도 두 출판사로 갈라진다", len(big_parts), 2)
check(f"800권 무리를 1초 안에 처리한다 ({_elapsed:.2f}초)", _elapsed < 1.0, True)


print("\n" + "=" * 60)
if failures:
    print(f"  ❌ 실패 {len(failures)}건: {', '.join(failures)}")
    raise SystemExit(1)
print("  ✅ 매칭 규칙 시험 전부 통과")
raise SystemExit(0)
