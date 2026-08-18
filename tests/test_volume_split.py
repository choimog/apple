"""
시리즈 권 번호가 다르면 다른 책으로 갈라내는지 시험.

【2026-08-18 대표님 지시】
  "매칭 시, 이런 식으로 두 도서가 시리즈로 도서로 유사한 제목과 넘버링을
   가지고 있는 경우에는, 넘버링이 다르면 명확하게 다른 도서로 구분지어줄
   필요가 있을 거거든?"

검토 화면에 올라와 있던 실제 짝 두 건입니다. **둘 다 89점**이었습니다.

    수상한생선의 진짜로 해부하는 과학책 1          (알라딘)
    수상한 생선의 진짜로 해부하는 과학책 2 육상생물 (예스24)   제목 78% 닮음

    빛과 수의 시대 1  (알라딘)
    빛과 수의 시대 2  (교보)                                 제목 79% 닮음

저자·출판사·출간월이 전부 같아서 **점수로는 묶는 것이 맞다고 나옵니다.**
번호만이 유일한 차이인데 그 번호를 아무도 안 보고 있었습니다.

🚨 이 시험의 절반은 **반대쪽**입니다. 갈라내는 규칙은 언제나
   '갈라지면 안 되는 것까지 갈라내는' 위험을 같이 키웁니다.
   연도(2026 …) · 판형(개정 3판) · 세트(전 7 권) 를 권 번호로 잘못 읽으면
   멀쩡한 짝이 조용히 갈라집니다. 화면에는 아무 표시도 안 납니다.

실행: python tests/test_volume_split.py
※ 인터넷도 DB 도 필요 없습니다.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

from common import config as cfg              # noqa: E402
from common import normalize as norm          # noqa: E402
from common.match import Candidate, compare   # noqa: E402

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


def mk(store_id, title, author, publisher, pub_ym, price=None, sb_id=1):
    t = norm.normalize_title(title, E, CN, B)
    return Candidate(
        id=sb_id, store_id=store_id,
        norm_title=t["core"],
        norm_author=norm.normalize_author(author, R),
        norm_publisher=norm.normalize_publisher(publisher, P),
        pub_ym=pub_ym, isbn13=None,
        edition_tags=t["editions"], set_volumes=t["set_volumes"],
        list_price=price,
        raw_title=title,
    )


def judge(x, y):
    """x = 알라딘(3), y = 교보(1) 로 놓고 비교합니다."""
    return compare(mk(3, *x, sb_id=101), mk(1, *y, sb_id=102), CFG)


# =============================================================================
print("\n[1] 번호를 꺼내는가")
# =============================================================================
cases = [
    ("빛과 수의 시대 1", 1),
    ("빛과 수의 시대 2", 2),
    ("수상한 생선의 진짜로 해부하는 과학책 2 육상생물", 2),
    ("수상한생선의 진짜로 해부하는 과학책 1", 1),
    ("슬램덩크 1권", 1),
    ("제 12권 대망", 12),
    ("원피스 100", 100),
    ("빛과수의시대2", 2),                    # 띄어쓰기 없이 붙은 것
]
for title, want in cases:
    got = norm.extract_volume(title)
    check(f"『{title}』 → {want}권", got == want, got)

print("\n[2] 🚨 번호가 아닌 것을 번호로 읽지 않는가")
# 여기가 무너지면 멀쩡한 짝이 조용히 갈라집니다.
not_volume = [
    "2026 원큐패스 한국사능력검정시험",       # 맨 앞 연도
    "2026 수능특강 영어",
    "개정 3판 데이터베이스 개론",             # 판형
    "미시경제학 (제7판)",
    "전 7 권 세트",                          # 세트는 set_volumes 가 봄
    "해리포터와 마법사의 돌 (전2권)",
    "코스모스",
    "총, 균, 쇠",
    "1일 1페이지 세계사",                    # 숫자가 글자에 붙어 있음
    "나는 4시간만 일한다",
    "영어회화 100일의 기적",
    "토익 750점 완성",
    "코스모스2024",                          # 네 자리는 권 번호가 아님
    "부의 추월차선 10주년 기념판",
]
for title in not_volume:
    got = norm.extract_volume(title)
    check(f"『{title}』 → 번호 없음", got is None, got)

print("\n[3] 🚨 대표님이 보내주신 실제 두 짝 — 갈라져야 합니다")
a = ("수상한생선의 진짜로 해부하는 과학책 1", "수상한생선", "위즈덤하우스", "2026-05")
b = ("수상한 생선의 진짜로 해부하는 과학책 2 육상생물", "수상한생선", "위즈덤하우스", "2026-05")
r = judge(a, b)
check("과학책 1 ↔ 2 는 다른 책", r.decision == "rejected", r.decision)
check("이유를 '권 번호가 다름' 으로 적는다",
      r.reasons.get("rejected_by") == "권 번호가 다름", r.reasons)
check("몇 권끼리 갈랐는지도 적는다",
      (r.reasons.get("a"), r.reasons.get("b")) == (1, 2), r.reasons)

c = ("빛과 수의 시대 1", "김상욱", "동아시아", "2026-06")
d = ("빛과 수의 시대 2", "김상욱", "동아시아", "2026-06")
r2 = judge(c, d)
check("빛과 수의 시대 1 ↔ 2 는 다른 책", r2.decision == "rejected", r2.decision)
check("이유를 적는다",
      r2.reasons.get("rejected_by") == "권 번호가 다름", r2.reasons)

# 예전에는 이 짝들이 89점으로 묶였습니다. 규칙을 끄면 그때로 돌아가는지
# 확인합니다 — 껐을 때 도로 묶여야 이 규칙이 진짜로 일하는 것입니다.
off = {**CFG, "thresholds": {**CFG["thresholds"], "volume_hard": False}}
r3 = compare(mk(3, *c, sb_id=101), mk(1, *d, sb_id=102), off)
check("규칙을 끄면 예전처럼 묶인다 (이 규칙이 실제로 일한다는 증거)",
      r3.is_same_book, r3.decision)
check("예전 점수가 실제로 높았다 (85점 이상)", r3.score >= 85, r3.score)

print("\n[4] 🚨 갈라지면 안 되는 것")

# ① 같은 번호는 그대로 묶입니다
same = judge(("빛과 수의 시대 2", "김상욱", "동아시아", "2026-06"),
             ("빛과 수의 시대 2", "김상욱", "동아시아", "2026-06"))
check("번호가 같으면 묶인다", same.is_same_book, same.decision)

# ② 🚨 한쪽에만 번호가 있으면 갈라내지 않습니다.
#    1권은 번호를 안 붙이고 파는 일이 흔합니다. '없음' 을 '1권' 으로
#    치면 아래 짝이 갈라집니다.
one_side = judge(("해리포터와 마법사의 돌 1", "조앤롤링", "문학수첩", "2026-03"),
                 ("해리포터와 마법사의 돌", "조앤롤링", "문학수첩", "2026-03"))
check("한쪽에만 번호가 있으면 갈라내지 않는다",
      one_side.reasons.get("rejected_by") != "권 번호가 다름",
      one_side.reasons)

# ③ 연도가 다르다고 갈라내면 안 됩니다 (연도는 번호가 아닙니다).
#    ※ 실제로 다른 책이라면 출간월·정가 같은 다른 규칙이 갈라냅니다.
year = judge(("2026 원큐패스 한국사", "이시원", "다락원", "2026-01"),
             ("2026 원큐패스 한국사", "이시원", "다락원", "2026-01"))
check("맨 앞 연도는 번호로 안 본다", year.is_same_book, year.decision)

# ④ 판형 번호(제7판)로 갈라내면 안 됩니다 — 에디션 규칙이 따로 봅니다.
ed = judge(("미시경제학 제7판", "이준구", "문우사", "2026-02"),
           ("미시경제학 제7판", "이준구", "문우사", "2026-02"))
check("판형 번호는 번호로 안 본다", ed.is_same_book, ed.decision)

print("\n[5] 순서 — 세트가 먼저, 그다음 권 번호")
# '전 7 권' 은 set_volumes 가 봅니다. 권 번호로 잘못 읽으면 이유가
# '권 번호가 다름' 으로 적혀서, 나중에 왜 갈라졌는지 못 찾습니다.
st = judge(("데미안 전 7 권", "헤르만헤세", "민음사", "2026-01"),
           ("데미안", "헤르만헤세", "민음사", "2026-01"))
check("세트는 '세트 권수가 다름' 으로 적는다",
      st.reasons.get("rejected_by") == "세트 권수가 다름", st.reasons)

print("\n[6] 설정 한 줄로 되돌릴 수 있는가")
check("config/matching.yaml 에 volume_hard 가 있다",
      "volume_hard" in CFG["thresholds"])
check("지금은 켜져 있다", CFG["thresholds"]["volume_hard"] is True)

# =============================================================================
print("\n[7] 🚨 번호 없는 책을 다리 삼아 1권과 2권이 이어지지 않는가")
# =============================================================================
#  두 권씩 비교할 때는 규칙이 맞는데, 무리를 만들 때 이어진 것을 계속
#  따라가면 이렇게 됩니다.
#
#      빛과 수의 시대 1 ─ (번호가 안 적힌 빛과 수의 시대) ─ 빛과 수의 시대 2
#
#  가운데 책은 번호가 없어서 양쪽 다 통과합니다. 출판사에서 똑같은 일이
#  있었고(split_by_publisher), 같은 방법으로 막습니다.
import types                                          # noqa: E402

_fake = types.ModuleType("supabase")
_fake.Client = object
_fake.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _fake)

from run_match import split_by_volume                 # noqa: E402

by_id = {
    11: {"raw_title": "빛과 수의 시대 1", "store_id": 3},
    12: {"raw_title": "빛과 수의 시대", "store_id": 2},     # 번호 없음
    13: {"raw_title": "빛과 수의 시대 2", "store_id": 1},
}
# 12번은 11번과 더 높은 점수로 이어졌습니다 → 1권 쪽에 붙어야 합니다.
scores = {(11, 12): 92.0, (12, 13): 88.0}
parts = split_by_volume([11, 12, 13], by_id, scores)
check("1권과 2권이 갈라진다", len(parts) == 2, parts)
check("번호 없는 책은 점수가 높은 쪽에 붙는다",
      sorted(parts) == [[11, 12], [13]], parts)

# 번호가 하나뿐이면 손대지 않습니다 (멀쩡한 무리를 쪼개면 안 됩니다).
same_vol = {
    21: {"raw_title": "빛과 수의 시대 2", "store_id": 3},
    22: {"raw_title": "빛과 수의 시대", "store_id": 2},
    23: {"raw_title": "빛과 수의 시대 2", "store_id": 1},
}
check("번호가 하나뿐이면 그대로 둔다",
      split_by_volume([21, 22, 23], same_vol, {}) == [[21, 22, 23]])

# 번호를 아무도 안 적었으면 그대로 둡니다.
no_vol = {
    31: {"raw_title": "코스모스", "store_id": 3},
    32: {"raw_title": "코스모스", "store_id": 1},
}
check("번호가 전혀 없으면 그대로 둔다",
      split_by_volume([31, 32], no_vol, {}) == [[31, 32]])

# 붙일 근거(짝지어진 기록)가 없으면 혼자 둡니다. 아무 쪽에나 붙이지 않습니다.
lonely = split_by_volume([11, 12, 13], by_id, {})
check("붙일 근거가 없으면 혼자 둔다", len(lonely) == 3, lonely)

print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    sys.exit(1)
print("✅ 모두 통과")
