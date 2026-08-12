"""
🚨 [출판사 묶기] — 사람이 정한 것이 계산을 꼬이게 하지 않는지 봅니다.

【2026-08-12 대표님 요청】
    "한빛life 랑 한빛라이프처럼, 서점마다 출판사를 표기하는 명칭이 조금씩
     다른데 이것도 다 규칙화하기 어려울 것 같아서.
     지금 규칙으로 나오는 결과가 마음에 들어서 괜히 건드렸다가 꼬이게 하고
     싶지 않아서 저런 방식을 따로 만들고 싶은데 어때?
     근데 저렇게 했을 때, 계산이 꼬여서 엉망이 될 리스트가 높다면 하고
     싶진 않아."

**"꼬이지 않는다" 를 말로만 하면 안 됩니다.** 이 시험이 그것을 지킵니다.

  ① 정해 둔 짝만 1.00 이 되고, **나머지는 값이 한 톨도 안 변한다**
  ② 표를 비우면 **정확히 원래대로** 돌아간다 (되돌리기가 진짜인가)
  ③ 🚨 출판사를 보는 자리 셋이 **같은 표**를 쓴다
     (한 군데만 쓰면 매칭이 붙인 것을 검사기가 신고하고 멈춥니다 —
      2026-08-12 에 같은 종류로 두 번 멈췄습니다)

실행: python tests/test_publisher_alias.py
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

from common import config as cfg              # noqa: E402
from common import normalize as norm          # noqa: E402
from common.match import (                    # noqa: E402
    publisher_aliases, publisher_sides, publisher_similarity,
    set_publisher_aliases,
)
from common.names import canonical_map        # noqa: E402

CFG = cfg.load("matching.yaml")
PW = CFG["publisher_words"]
FLOOR = CFG["thresholds"]["publisher_hard_floor"]

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


def pub(x):
    return norm.normalize_publisher(x, PW)


# 값이 변하면 안 되는 짝들 — 이 시험의 핵심입니다.
UNTOUCHED = [
    ("민음사", "문학동네"), ("창비", "창비교육"), ("김영사", "김영사on"),
    ("한빛미디어", "한빛비즈"), ("문학동네", "문학동네어린이"),
    ("민음사", "(주)민음사"), ("윌북(willbook)", "윌북"),
    ("YBM(와이비엠)", "와이비엠"), ("샘터", "샘터사"),
    ("한빛라이프", "한빛미디어"),
]

print("\n[0] 처음에는 표가 비어 있어야 합니다")
set_publisher_aliases(None)
check("빈 표로 시작", publisher_aliases() == {}, publisher_aliases())

print("\n[1] 표를 넣기 전 값을 적어 둡니다")
before = {(a, b): publisher_similarity(pub(a), pub(b)) for a, b in UNTOUCHED}
check("한빛life ≠ 한빛라이프 (아직 남남)",
      publisher_similarity(pub("한빛life"), pub("한빛라이프")) < FLOOR,
      publisher_similarity(pub("한빛life"), pub("한빛라이프")))

print("\n[2] '한빛life = 한빛라이프' 를 정합니다")
ALIAS = {pub("한빛life"): "한빛라이프", pub("한빛라이프"): "한빛라이프"}
check("표가 들어갔다", set_publisher_aliases(ALIAS) == 2)
check("🚨 정한 짝은 같은 출판사가 된다",
      publisher_similarity(pub("한빛life"), pub("한빛라이프")) == 1.0)
check("괄호가 붙어 있어도 잡는다 (한빛life(hanbit))",
      publisher_similarity(pub("한빛life(hanbit)"), pub("한빛라이프")) == 1.0)

print("\n[3] 🚨 나머지는 값이 한 톨도 안 변해야 합니다")
for key, was in before.items():
    now = publisher_similarity(pub(key[0]), pub(key[1]))
    check(f"{key[0]} vs {key[1]} — {was:.2f} 그대로", now == was, now)

print("\n[4] 🚨 정하지 않은 이름까지 딸려 들어오면 안 됩니다")
check("한빛life ≠ 한빛미디어 (안 정했으니 남남)",
      publisher_similarity(pub("한빛life"), pub("한빛미디어")) < FLOOR,
      publisher_similarity(pub("한빛life"), pub("한빛미디어")))
sides = publisher_sides([pub("한빛life"), pub("한빛라이프"), pub("한빛미디어")], FLOOR)
check("한빛life·한빛라이프는 한 편, 한빛미디어는 따로", len(sides) == 2, sides)

print("\n[5] 화면에 쓸 이름도 대표 이름으로 바뀐다")
raws = ["한빛life", "한빛life", "한빛라이프", "민음사"]
canon, _, _ = canonical_map(((pub(r), r) for r in raws), use_alias=True, declared=ALIAS)
check("한빛life → 한빛라이프", canon[pub("한빛life")] == "한빛라이프",
      canon[pub("한빛life")])
check("한빛라이프 → 한빛라이프", canon[pub("한빛라이프")] == "한빛라이프")
check("🚨 상관없는 곳은 그대로", canon[pub("민음사")] == "민음사", canon[pub("민음사")])

print("\n[6] 🚨 풀면 정확히 원래대로 (되돌리기가 진짜인가)")
set_publisher_aliases(None)
check("표가 비었다", publisher_aliases() == {})
same = all(publisher_similarity(pub(a), pub(b)) == was
           for (a, b), was in before.items())
check("모든 값이 표 넣기 전과 똑같다", same)
check("한빛life 도 다시 남남이 된다",
      publisher_similarity(pub("한빛life"), pub("한빛라이프")) < FLOOR)
canon2, _, _ = canonical_map(((pub(r), r) for r in raws), use_alias=True)
check("화면 이름도 원래대로", canon2[pub("한빛life")] != "한빛라이프",
      canon2[pub("한빛life")])

print("\n[7] 이상한 값이 들어와도 죽지 않는다")
check("빈 이름은 무시", set_publisher_aliases({"": "가", "나": ""}) == 0)
check("None 도 괜찮다", set_publisher_aliases(None) == 0)

print("\n[8] 🚨 출판사를 보는 자리 셋이 같은 표를 쓰는가 (글자로 확인)")
RUN = (ROOT / "crawler" / "run_match.py").read_text(encoding="utf-8")
VERIFY = (ROOT / "crawler" / "verify_publishers.py").read_text(encoding="utf-8")
MATCH = (ROOT / "crawler" / "common" / "match.py").read_text(encoding="utf-8")

check("① 잣대 안에 표가 들어 있다", "_ALIAS_OF" in MATCH)
check("② 매칭이 시작할 때 표를 넣는다",
      "set_publisher_aliases(pub_alias)" in RUN)
check("② 화면 이름에도 같은 표를 넘긴다", "declared=pub_alias" in RUN)
check("🚨 ③ 검사기도 같은 표를 넣는다",
      "set_publisher_aliases(alias)" in VERIFY,
      "안 넣으면 제대로 묶인 책을 신고하고 [도서 매칭] 이 멈춥니다")

DB = (ROOT / "crawler" / "common" / "db.py").read_text(encoding="utf-8")
check("표가 아직 없어도 매칭이 멈추지 않는다",
      "없는 것으로 봅니다" in DB,
      "SQL 을 안 돌리셨을 때 매칭 전체가 죽으면 안 됩니다")

SQL = (ROOT / "db" / "publisher-alias.sql").read_text(encoding="utf-8")
check("관리자만 묶을 수 있다", "is_admin() AND created_by = auth.uid()" in SQL)
check("풀기(지우기)가 열려 있다 — 되돌릴 수 있어야 합니다",
      "FOR DELETE" in SQL)

ROUTE = (ROOT / "web" / "app" / "review" / "publishers" / "decide" / "route.ts").read_text(
    encoding="utf-8")
check("저장된 줄 수를 세어 확인한다", "!== keys.length" in ROUTE,
      "안 세면 규칙에 막혀 0줄이 저장돼도 '성공' 이라고 합니다")
check("풀 때도 지워진 줄 수를 확인한다", "if (!gone?.length)" in ROUTE)

print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    for f in failures:
        print(f"   · {f}")
    raise SystemExit(1)
print("✅ 모두 통과")
