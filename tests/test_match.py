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


print("\n[5] 예시 C — 검토 대기가 되는 경우 (문서 6절)")
a = make(2, "아버지의 해방일지", "정지아 저", "창비", "2022-09", sb_id=301)
b = make(3, "아버지의 해방일지", "정지아 (지은이)", None, "2022-10", sb_id=302)
r = compare(a, b, CFG)
print(f"  ℹ️ 점수 {r.score}점 · 근거 {r.reasons}")
check("검토 대기로 묶인다", r.decision, "auto_low")
check("출판사는 값 없음으로 0점", r.reasons["publisher"], "missing")


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


print("\n" + "=" * 60)
if failures:
    print(f"  ❌ 실패 {len(failures)}건: {', '.join(failures)}")
    raise SystemExit(1)
print("  ✅ 매칭 규칙 시험 전부 통과")
raise SystemExit(0)
