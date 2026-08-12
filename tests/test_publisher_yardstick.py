"""
🚨 출판사를 견주는 '잣대' 가 세 군데에서 똑같은지 확인합니다.

【2026-08-12 — 실제로 두 번 터진 실수입니다】

출판사가 같은지 보는 자리가 세 군데입니다.

    ① crawler/common/match.py       두 권을 붙일지 정할 때
    ② crawler/run_match.py          무리에 출판사가 섞였으면 갈라낼 때
    ③ crawler/verify_publishers.py  묶은 결과가 맞는지 검사할 때

**셋이 같은 잣대를 써야 합니다.** 안 그러면 이런 일이 납니다.

  · ① 만 고쳤을 때 (실제로 났습니다)
      매칭은 '윌북(willbook)' 과 '윌북' 을 한 책으로 붙였는데,
      ③ 검사기가 옛 잣대로 재서 **제대로 묶인 359종을 잘못됐다고
      신고**하고 [도서 매칭] 을 통째로 멈췄습니다.

  · ② 를 안 고치면
      ① 이 붙인 것을 ② 가 도로 갈라냅니다. 매일 붙였다 뗐다 합니다.
      화면에는 아무 표시도 안 나고, 순위만 조용히 흔들립니다.

이 시험은 **글자로** 세 군데를 지킵니다. 누가 한 군데만 고치면 걸립니다.

실행: python tests/test_publisher_yardstick.py
※ 인터넷도 DB 도 필요 없습니다.
"""

from __future__ import annotations

import re
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

_fake = types.ModuleType("supabase")
_fake.Client = object
_fake.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _fake)

from common import config as cfg          # noqa: E402
from common import normalize as norm      # noqa: E402
from common.match import publisher_sides, publisher_similarity  # noqa: E402

CFG = cfg.load("matching.yaml")
P = CFG["publisher_words"]
FLOOR = CFG["thresholds"]["publisher_hard_floor"]

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


def pub(x):
    return norm.normalize_publisher(x, P)


MATCH = (ROOT / "crawler" / "common" / "match.py").read_text(encoding="utf-8")
RUN = (ROOT / "crawler" / "run_match.py").read_text(encoding="utf-8")
VERIFY = (ROOT / "crawler" / "verify_publishers.py").read_text(encoding="utf-8")

print("\n[1] 🚨 세 군데가 같은 잣대를 쓰는가")

# ① 두 권을 붙일지 정하는 자리
check("① match.py — 출판사 문턱을 publisher_similarity 로 잰다",
      re.search(r"pub_sim = publisher_similarity\(", MATCH) is not None)
check("① match.py — 출판사 점수도 같은 잣대",
      MATCH.count("publisher_similarity(a.norm_publisher, b.norm_publisher)") >= 2,
      MATCH.count("publisher_similarity(a.norm_publisher, b.norm_publisher)"))

# ② 무리에서 출판사가 섞였으면 갈라내는 자리
check("② run_match.py — 편 나누기를 publisher_sides 로 한다",
      "publisher_sides(names, floor)" in RUN)
check("🚨 ② run_match.py — 이름 비교에 옛 잣대(similarity)를 안 쓴다",
      re.search(r"if similarity\(names\[x\], names\[y\]\)", RUN) is None,
      "여기서 옛 잣대를 쓰면 ① 이 붙인 것을 도로 갈라냅니다")

# ③ 검사기
check("③ verify_publishers.py — 매칭과 같은 함수를 가져다 쓴다",
      "publisher_similarity as similarity" in VERIFY
      or "publisher_similarity" in VERIFY)
check("🚨 ③ verify_publishers.py — 옛 similarity 를 직접 안 가져온다",
      re.search(r"^from common\.match import similarity", VERIFY, re.M) is None,
      "검사기가 옛 잣대를 쓰면 멀쩡한 묶음을 실패로 몰고 작업을 멈춥니다")
check("🚨 ③ verify_publishers.py — 편 나누기도 같은 함수로 한다",
      "publisher_sides(names, floor)" in VERIFY,
      "검사기가 따로 세면 갈라내지도 않을 것을 잘못됐다고 신고합니다")
check("🚨 ③ verify_publishers.py — '두 개씩 전부 닮아야 한다' 로 안 센다",
      re.search(r"worst = min\(worst, similarity\(names\[i\], names\[j\]\)\)\n\n\s*if worst < floor",
                VERIFY) is None,
      "YBM / 와이비엠 처럼 한글·영문이 섞이면 0.00 이 나옵니다")

print("\n[2] 실제로 신고됐던 359건 — 이제 셋 다 '같은 출판사' 로 봐야 합니다")
# 2026-08-12 [도서 매칭] 이 여기서 멈췄습니다. 그때 나온 값 그대로입니다.
REPORTED = [
    ("아티초크(Artichoke Publishing House)", "아티초크", 0.17),
    ("윌북(willbook)", "윌북", 0.19),
    ("느루(미래인재컴퍼니)", "느루", 0.20),
    ("꿈미", "꿈미(꿈이있는미래)", 0.22),
    ("웨일북", "웨일북(whalebooks)", 0.24),
]
for a, b, before in REPORTED:
    now = publisher_similarity(pub(a), pub(b))
    check(f"{a} = {b}  (예전 {before:.2f} → 지금 {now:.2f})", now >= FLOOR, now)

print("\n[2-2] 검사기가 신고했던 8종 — 세 표기가 '한 편' 으로 이어져야 합니다")
# 2026-08-12 두 번째로 [도서 매칭] 이 여기서 멈췄습니다.
# 한 책에 서점마다 세 가지 표기가 들어오는데, 그중 두 개만 떼어 놓고 재면
# 0.00 이 나옵니다(한글·영문). 가운데 표기가 이어 주는 것을 봐야 합니다.
FLAGGED = [
    ("ETS 토익 정기시험 기출입문서 RC",
     ["YBM(와이비엠)", "YBM", "와이비엠"], 0.00),
    ("교과서 소설 다보기 2",
     ["C&A에듀(씨앤에이에듀)", "C&A에듀", "씨앤에이에듀"], 0.24),
    ("책이라면 팔 만큼 1",
     ["미우(대원씨아이)", "미우(대원)", "대원씨아이"], 0.41),
    ("색연필로 그리는 나의 작은 프랑스 정원",
     ["도서출판 이종(EJONG)", "도서출판이종", "EJONG(이종문화사)"], 0.41),
    ("도스토옙스키 번역 일기",
     ["샘터", "샘터사", "샘터(샘터사)"], 0.65),
    ("미야모토 시게루의 게임론",
     ["AK(에이케이 커뮤니케이션즈)", "에이케이커뮤니케이션즈",
      "AK(에이케이)커뮤니케이션즈"], 0.71),
]
for title, raws, before in FLAGGED:
    sides = publisher_sides([pub(r) for r in raws], FLOOR)
    check(f"{title} — {' / '.join(raws)}  (예전 {before:.2f} 로 신고됨)",
          len(sides) == 1, f"편이 {len(sides)}개로 갈렸습니다")

print("\n[3] 🚨 그래도 진짜 섞인 것은 잡아야 합니다")
# 이 검사기는 '싯다르타' 가 민음사·문학동네·다산북스로 뭉쳐 있던 것을
# 잡으려고 만든 것입니다. 그 능력을 잃으면 안 됩니다.
for a, b in [("민음사", "문학동네"), ("창비", "다산북스"), ("서정시학", "민음사"),
             ("창비", "창비교육"), ("김영사", "김영사on"), ("한빛미디어", "한빛비즈"),
             ("문학동네", "문학동네어린이")]:
    sim = publisher_similarity(pub(a), pub(b))
    check(f"{a} ≠ {b} ({sim:.2f})", sim < FLOOR, sim)

# '이어지면 한 편' 이 되면서 이것까지 뭉치면 안 됩니다.
# 싯다르타 사건 그대로입니다 — 이어 줄 이름이 없으면 그대로 세 편입니다.
for raws, want in [(["민음사", "문학동네", "서정시학"], 3),
                   (["민음사", "(주)민음사", "문학동네"], 2),
                   (["창비", "창비교육", "다산북스"], 3)]:
    sides = publisher_sides([pub(r) for r in raws], FLOOR)
    check(f"{' / '.join(raws)} → {want}편", len(sides) == want, len(sides))

print("\n[4] 괄호가 없는 평범한 경우도 그대로")
for a, b, want_same in [("(주)민음사", "민음사", True),
                        ("민음사", "민음사", True),
                        ("주식회사창비", "창비", True)]:
    sim = publisher_similarity(pub(a), pub(b))
    check(f"{a} {'=' if want_same else '≠'} {b} ({sim:.2f})",
          (sim >= FLOOR) == want_same, sim)
check("한쪽이 비면 0", publisher_similarity(None, "민음사") == 0.0)
check("둘 다 비면 0", publisher_similarity(None, None) == 0.0)

print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    for f in failures:
        print(f"   · {f}")
    raise SystemExit(1)
print("✅ 모두 통과")
