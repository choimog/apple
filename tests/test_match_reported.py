"""
대표님이 "이건 왜 안 묶이지?" 하고 알려주신 실제 책들 시험.

【2026-08-12】
수집과 매칭이 잘 돌아간 뒤, 대표님이 안 묶인 책 10건을 보내주셨습니다.
원인은 네 가지였습니다.

  ① 출판사 뒤 괄호 부기      필름(Feelm) vs 필름          닮은 정도 0.24
                            윌북(willbook) vs 윌북        0.19
                            (주)YBM(와이비엠) vs YBM      0.38
     → 출판사가 0.80 만큼 안 닮으면 점수를 보기도 전에 다른 책입니다.

  ② 출판사 접두어            도서출판 숲 vs 숲             0.25
     → '출판' 만 떼서 '도서숲' 이 남았습니다.

  ③ 출간월이 크게 다름       데미안 2000-12 vs 2009-01
     → 같은 책의 다른 쇄(刷)를 서점마다 다른 날짜로 적은 것입니다.

  ④ 제목에 배지 문구         문해내공 vs 예약판매문해내공   0.55
     → 서점 화면의 '예약판매' 배지가 제목에 딸려 왔습니다.

  ⑤ 외국 저자명 표기         알베르 카뮈 vs 알베르 까뮈     0.57

**이 시험은 대표님이 주신 값을 그대로 씁니다.** 규칙을 다시 손댈 때
이 책들이 또 갈라지면 여기서 걸립니다.

그리고 🚨 **갈라져야 하는 것이 붙지 않는지**도 같은 무게로 봅니다.
느슨하게 만드는 변경은 항상 반대쪽 위험을 같이 키웁니다.

실행: python tests/test_match_reported.py
※ 인터넷도 DB 도 필요 없습니다.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

from common import config as cfg          # noqa: E402
from common import normalize as norm      # noqa: E402
from common.match import Candidate, compare  # noqa: E402

CFG = cfg.load("matching.yaml")
E = CFG["edition_words"]
CN = CFG.get("edition_canonical") or {}
R = CFG["role_words"]
P = CFG["publisher_words"]
B = CFG.get("title_badge_words")

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


def mk(store_id, title, author, publisher, pub_ym, price, sb_id):
    t = norm.normalize_title(title, E, CN, B)
    return Candidate(
        id=sb_id, store_id=store_id,
        norm_title=t["core"],
        norm_author=norm.normalize_author(author, R),
        norm_publisher=norm.normalize_publisher(publisher, P),
        pub_ym=pub_ym, isbn13=None,
        edition_tags=t["editions"], set_volumes=t["set_volumes"],
        list_price=price,
    )


def judge(x, y):
    return compare(mk(1, *x, 101), mk(3, *y, 102), CFG)


print("\n[1] 🚨 대표님이 알려주신 10건 — 이제 묶여야 합니다")

REPORTED = [
    ("(1) 수족관",
     ("수족관", "유래혁", "포스터샵", None, 17700),
     ("수족관", "유래혁", "포스터샵", "2023-12", 17700), True),
    ("(2) ETS 토익",
     ("ETS 토익 정기시험 기출문제집 1000 Vol. 5 Reading (리딩)", "ETS",
      "(주)YBM(와이비엠)", "2025-12", 22000),
     ("ETS 토익 정기시험 기출문제집 1000 Vol 5 RC", "ETS", "YBM", "2025-12", 22000), True),
    ("(3) 돈의 심리학",
     ("돈의 심리학 (50만 부 기념 뉴 에디션)", "모건 하우절", "인플루엔셜", "2026-01", 24800),
     ("돈의 심리학 (50만 부 기념 뉴 에디션)", "모건 하우절", "인플루엔셜(주)", "2021-01", 24800), True),
    ("(4) 데미안",
     ("데미안", "헤르만 헤세", "민음사", "2000-12", 8000),
     ("데미안", "헤르만 헤세", "민음사", "2009-01", 8000), True),
    ("(5) 수험생을 위한 100일 기도",
     ("수험생을 위한 100일 기도", "김종국", "생활성서사", "2019-07", 16000),
     ("수험생을 위한 100일 기도", "김종국", "생활성서사", "2008-05", 16000), True),
    ("(6) 오뒷세이아",
     ("오뒷세이아", "호메로스", "도서출판 숲", "2015-09", 33000),
     ("오뒷세이아", "호메로스", "숲", "2015-09", 33000), True),
    ("(8) 이방인",
     ("이방인", "알베르 카뮈", "민음사", "2019-09", 10000),
     ("이방인", "알베르 까뮈", "민음사", "2011-03", 10000), True),
    ("(9) 어떻게 살아낼 것인가",
     ("어떻게 살아낼 것인가", "짐 콜린스", "필름(Feelm)", "2026-07", 29800),
     ("어떻게 살아낼 것인가", "짐 콜린스", "필름", "2026-07", 29800), True),
    ("(10) 내면 근력",
     ("내면 근력", "짐 머피", "윌북(willbook)", "2026-04", 22000),
     ("내면 근력", "짐 머피", "윌북", "2026-04", 22000), True),
]
for label, x, y, want_high in REPORTED:
    r = judge(x, y)
    check(f"{label} — {r.score}점 {r.decision}",
          r.decision == "auto_high" if want_high else r.is_same_book,
          r.reasons)

print("\n[2] (7) 문해내공 — 제목은 붙었지만 저자가 다릅니다")
# '예약판매' 배지는 떼었습니다. 하지만 저자가 '김윤정' vs '신종호 외' 로
# 완전히 다릅니다. 이건 사람이 봐야 하는 경우라 **검토 대기가 맞습니다.**
# 자동으로 묶어 버리면 진짜 다른 책일 때 되돌릴 방법이 없습니다.
r = judge(("문해내공", "김윤정", "상상스퀘어", "2026-08", 25000),
          ("예약판매문해내공", "신종호 외", "상상스퀘어", "2026-08", 25000))
check(f"검토 대기로 올라온다 ({r.score}점)", r.decision == "auto_low", r.reasons)
check("제목은 배지를 떼어 같아졌다",
      norm.normalize_title("예약판매문해내공", E, CN, B)["core"] == "문해내공",
      norm.normalize_title("예약판매문해내공", E, CN, B)["core"])

print("\n[3] 🚨 그래도 갈라져야 하는 것은 갈라진다 (반대쪽 위험)")
MUST_SPLIT = [
    ("출판사가 진짜 다름 (싯다르타)",
     ("싯다르타", "헤르만 헤세", "민음사", "2020-01", 9000),
     ("싯다르타", "헤르만 헤세", "문학동네", "2020-01", 9000)),
    ("정가가 다름",
     ("데미안", "헤르만 헤세", "민음사", "2000-12", 8000),
     ("데미안", "헤르만 헤세", "민음사", "2009-01", 12000)),
    ("개정판이 섞임",
     ("데미안 (개정판)", "헤르만 헤세", "민음사", "2000-12", 8000),
     ("데미안", "헤르만 헤세", "민음사", "2009-01", 8000)),
    ("양장본이 섞임",
     ("데미안 (양장본)", "헤르만 헤세", "민음사", "2000-12", 8000),
     ("데미안", "헤르만 헤세", "민음사", "2000-12", 8000)),
    ("세트 vs 낱권",
     ("해리 포터 세트 (전7권)", "조앤 롤링", "문학수첩", "2019-11", 150000),
     ("해리 포터", "조앤 롤링", "문학수첩", "2019-11", 150000)),
    ("저자가 다르고 출간월도 다름",
     ("데미안", "헤르만 헤세", "민음사", "2000-12", 8000),
     ("데미안", "김철수", "민음사", "2009-01", 8000)),
    ("🚨 정가를 한쪽만 아는데 출간월이 다름",
     ("데미안", "헤르만 헤세", "민음사", "2000-12", 8000),
     ("데미안", "헤르만 헤세", "민음사", "2009-01", None)),
]
for label, x, y in MUST_SPLIT:
    r = judge(x, y)
    check(f"{label} → 갈라짐", r.decision == "rejected", r.reasons)

print("\n[4] 출판사 괄호 부기 — 이미 모아 둔 자료에도 통해야 합니다")
# 🚨 【2026-08-12 — 한 번 잘못 고쳤던 자리입니다】
# 처음에는 저장할 때 괄호를 떼도록 고쳤습니다. 두 가지가 잘못됐습니다.
#   ① 저장값은 **수집할 때** 정해집니다. [도서 매칭] 만 다시 돌려서는
#      하나도 안 바뀝니다. 대표님이 "그대로야" 라고 하신 이유입니다.
#   ② 괄호 안에 진짜 이름이 든 경우를 잃습니다.
#        중앙books(중앙북스) → '중앙books'   ← 한글 이름이 사라짐
#      대표님 신고: "중앙북스가 다 따로 잡히는 문제가 발생해버렸어"
# 그래서 저장은 그대로 두고, **비교할 때 괄호 안팎을 다 후보로** 놓습니다.
from common.match import publisher_similarity, publisher_variants  # noqa: E402

FLOOR = CFG["thresholds"]["publisher_hard_floor"]


def pub(x):
    return norm.normalize_publisher(x, P)


print("  · 중앙북스 3형제 — 셋이 서로 다 같아야 합니다")
JOONG = ["중앙북스", "중앙북스(books)", "중앙books(중앙북스)"]
for i in range(len(JOONG)):
    for j in range(i + 1, len(JOONG)):
        sim = publisher_similarity(pub(JOONG[i]), pub(JOONG[j]))
        check(f"    {JOONG[i]} = {JOONG[j]} ({sim:.2f})", sim >= FLOOR, sim)

print("  · 표기만 다른 것은 같게")
for a, b in [("(주)창비", "창비"), ("필름(Feelm)", "필름"),
             ("윌북(willbook)", "윌북"), ("(주)YBM(와이비엠)", "YBM"),
             ("인플루엔셜(주)", "인플루엔셜")]:
    sim = publisher_similarity(pub(a), pub(b))
    check(f"    {a} = {b} ({sim:.2f})", sim >= FLOOR, sim)

print("  · 🚨 진짜 다른 출판사는 여전히 다르게")
for a, b in [("민음사", "문학동네"), ("창비", "창비교육"),
             ("김영사", "김영사on"), ("북21", "21세기북스"),
             ("한빛미디어", "한빛비즈")]:
    sim = publisher_similarity(pub(a), pub(b))
    check(f"    {a} ≠ {b} ({sim:.2f})", sim < FLOOR, sim)

print("  · 저장값을 안 바꿨는지 (안 바꿔야 이미 모은 자료에 통합니다)")
check("괄호를 저장할 때 떼지 않는다", pub("필름(Feelm)") == "필름(feelm)", pub("필름(Feelm)"))
check("괄호 안팎을 후보로 만든다",
      {"필름", "feelm"} <= publisher_variants("필름(feelm)"),
      publisher_variants("필름(feelm)"))

print("\n[4-1] ⚠️ 다음 수집을 기다려야 하는 것 — (6) 오뒷세이아")
# '도서출판 숲' 은 예전 규칙으로 '도서숲' 이라고 저장돼 있습니다.
# ('출판' 만 떼서 '도서' 가 남았습니다)
# publisher_words 에 '도서출판' 을 넣었지만, 그 값은 **수집할 때** 계산되므로
# 다음 수집 전까지는 '도서숲' 그대로입니다. 괄호 후보로도 못 고칩니다.
# 이 시험은 그 사실을 숨기지 않고 못박아 둡니다.
check("지금 저장된 값으로는 아직 안 붙는다 (다음 수집에 해결)",
      publisher_similarity("도서숲", "숲") < FLOOR,
      publisher_similarity("도서숲", "숲"))
check("다음 수집부터는 '숲' 으로 저장된다", pub("도서출판 숲") == "숲", pub("도서출판 숲"))

print("\n[5] 🚨 제목 배지가 진짜 제목을 깎지 않는다")
# 처음 만들었을 때 『예약판매의 기술』 이 『의 기술』 이 됐습니다.
for title in ("예약판매의 기술", "예약판매를 시작하며", "무료배송의 경제학"):
    core = norm.normalize_title(title, E, CN, B)["core"]
    plain = norm.normalize_title(title, E, CN, [])["core"]
    check(f"『{title}』 은 그대로", core == plain, core)
# 배지는 떼야 합니다
for badge, real in (("예약판매문해내공", "문해내공"), ("[예약판매] 문해내공", "문해내공"),
                    ("오늘출발 데미안", "데미안")):
    core = norm.normalize_title(badge, E, CN, B)["core"]
    want = norm.normalize_title(real, E, CN, B)["core"]
    check(f"『{badge}』 → 『{real}』", core == want, core)

print("\n[6] 외국 이름 표기 흔들림")
from common.match import name_similarity, same_name  # noqa: E402
for a, b in [("알베르카뮈", "알베르까뮈"), ("톨스토이", "똘스또이"),
             ("도스토옙스키", "도스또옙스끼"), ("카프카", "까프카")]:
    check(f"{a} = {b}", same_name(a, b), name_similarity(a, b))
# 🚨 진짜 다른 사람은 여전히 다릅니다
for a, b in [("김철수", "김영희"), ("헤르만헤세", "프란츠카프카")]:
    check(f"{a} ≠ {b}", not same_name(a, b), name_similarity(a, b))

print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    for f in failures:
        print(f"   · {f}")
    raise SystemExit(1)
print("✅ 모두 통과")
