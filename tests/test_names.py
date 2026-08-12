"""
🚨 웰컴의 [출판사 TOP 8] · [저자 TOP 8] 이 꼬이지 않는지 봅니다.

【2026-08-12 대표님 지적】
    "그런데 왜 웰컴에 보이는 출판사와 저자 순위는 계속 꼬여있는 상태야?"

순위표는 도서 마스터(books)에 적힌 **이름 글자 그대로** 세서 줄을 세웁니다.
그런데 그 이름을 '우선순위가 높은 서점이 적은 대로' 넣고 있었습니다.

    교보 YBM(와이비엠) / 예스24 YBM / 알라딘 와이비엠

그래서 **그 책을 어느 서점이 갖고 있었느냐로 이름표가 달라졌고**,
한 출판사가 순위표에서 두세 줄로 쪼개지며 점수까지 나뉘었습니다.

이 시험은 두 가지를 지킵니다.
  ① 흩어진 표기가 한 이름으로 모이는가
  ② 🚨 남남인 출판사가 딸려 들어오지는 않는가

실행: python tests/test_names.py
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
from collections import Counter                # noqa: E402

from common.names import canonical_map, choose_display  # noqa: E402
from common.normalize import fold_fortis      # noqa: E402
from run_match import pick_representative     # noqa: E402

CFG = cfg.load("matching.yaml")
PW = CFG["publisher_words"]
AW = CFG.get("role_words")

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


def pub_pairs(raws: list[str]):
    return [(norm.normalize_publisher(r, PW), r) for r in raws]


def author_pairs(raws: list[str]):
    return [(fold_fortis(norm.normalize_author(r, AW)), r) for r in raws]


def pub_names(raws: list[str]) -> set[str]:
    """이 표기들을 넣었을 때 화면에 몇 가지 이름이 남는가"""
    canon, _, _ = canonical_map(pub_pairs(raws), use_alias=True)
    return {canon[k] for k, _ in pub_pairs(raws) if k}


print("\n[1] 🚨 흩어진 출판사 표기가 한 줄로 모입니다")
CASES = [
    (["윌북(willbook)", "윌북", "윌북"], "윌북"),
    (["YBM(와이비엠)", "YBM", "YBM", "와이비엠"], "YBM"),
    (["샘터", "샘터", "샘터사", "샘터(샘터사)"], "샘터"),
    (["중앙북스", "중앙북스(books)", "중앙books(중앙북스)"], "중앙북스"),
    (["아티초크(Artichoke Publishing House)", "아티초크"], "아티초크"),
    (["꿈미", "꿈미(꿈이있는미래)"], "꿈미"),
    (["웨일북", "웨일북(whalebooks)"], "웨일북"),
    (["느루(미래인재컴퍼니)", "느루"], "느루"),
]
for raws, want in CASES:
    names = pub_names(raws)
    check(f"{' / '.join(dict.fromkeys(raws))} → 한 줄 '{want}'",
          names == {want}, names)

print("\n[2] 🚨 남남인 출판사가 딸려 들어오면 안 됩니다")
for raws, want_lines in [
    (["민음사", "문학동네", "서정시학"], 3),
    (["창비", "창비교육"], 2),
    (["김영사", "김영사on"], 2),
    (["한빛미디어", "한빛비즈"], 2),
    (["민음사", "(주)민음사"], 1),          # 표기만 다름 → 한 줄
]:
    names = pub_names(raws)
    check(f"{' / '.join(raws)} → {want_lines}줄", len(names) == want_lines, names)

print("\n[3] 🚨 흔한 낱말을 다리로 삼아 뭉치면 안 됩니다")
# '북스' 같은 조각이 여기저기서 겹치면 상관없는 출판사들이 한 덩어리가 됩니다.
crowd = [f"출판사{i}(북스)" for i in range(12)]
canon, ignored, _ = canonical_map(pub_pairs(crowd), use_alias=True)
check("12곳이 함께 쓰는 '북스' 로는 이어 붙이지 않는다",
      len({canon[k] for k, _ in pub_pairs(crowd) if k}) == 12,
      len({canon[k] for k, _ in pub_pairs(crowd) if k}))
check("버린 낱말을 화면에 알려 준다", "북스" in ignored, ignored)

print("\n[4] 저자 — 된소리·띄어쓰기만 다른 표기는 한 사람")
for raws, want_lines in [
    (["알베르 카뮈", "알베르 카뮈", "알베르 까뮈"], 1),
    (["히가시노 게이고", "히가시노게이고"], 1),
    (["김영하 (지은이)", "김영하"], 1),
    (["김영하", "김영해"], 2),               # 🚨 다른 사람은 그대로 둡니다
    (["한강", "한강 (지은이)", "김훈"], 2),
]:
    pairs = author_pairs(raws)
    canon, _, _ = canonical_map(pairs, use_alias=False)
    names = {canon[k] for k, _ in pairs if k}
    check(f"{' / '.join(dict.fromkeys(raws))} → {want_lines}줄",
          len(names) == want_lines, names)

print("\n[5] 화면에 쓸 이름 고르는 순서")
check("괄호 없는 쪽을 먼저 (수가 적어도)",
      choose_display(Counter({"윌북(willbook)": 9, "윌북": 1})) == "윌북")
check("둘 다 괄호가 없으면 많이 쓰인 쪽",
      choose_display(Counter({"와이비엠": 2, "YBM": 7})) == "YBM")
check("수까지 같으면 짧은 쪽",
      choose_display(Counter({"샘터사": 3, "샘터": 3})) == "샘터")

print("\n[6] 🚨 매칭이 실제로 그 이름을 쓰는가 (pick_representative)")
# 서점이 저마다 다르게 적어도, 도서 마스터에는 정한 이름 하나가 들어가야 합니다.
rows = [
    {"store_id": 1, "raw_title": "ETS 토익 RC", "raw_publisher": "YBM(와이비엠)",
     "norm_publisher": norm.normalize_publisher("YBM(와이비엠)", PW),
     "raw_author": "ETS", "norm_author": norm.normalize_author("ETS", AW)},
    {"store_id": 3, "raw_title": "ETS 토익 RC", "raw_publisher": "와이비엠",
     "norm_publisher": norm.normalize_publisher("와이비엠", PW),
     "raw_author": "ETS", "norm_author": norm.normalize_author("ETS", AW)},
]
canon, _, _ = canonical_map(
    [(r["norm_publisher"], r["raw_publisher"]) for r in rows], use_alias=True)
au, _, _ = canonical_map(
    [(fold_fortis(r["norm_author"]), r["raw_author"]) for r in rows], use_alias=False)

# 알라딘(3)이 우선이라 예전에는 무조건 '와이비엠' 이 들어갔습니다.
rep = pick_representative(rows, canon, au)
check("두 서점이 다르게 적어도 도서 마스터에는 한 이름",
      rep["publisher"] == choose_display(Counter({"YBM(와이비엠)": 1, "와이비엠": 1})),
      rep["publisher"])
check("정한 이름이 없으면 서점 글자를 그대로 씁니다",
      pick_representative(rows)["publisher"] == "와이비엠",
      pick_representative(rows)["publisher"])
check("제목·표지는 예전 그대로 (서점 우선순위)",
      rep["title"] == "ETS 토익 RC", rep["title"])

print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    for f in failures:
        print(f"   · {f}")
    raise SystemExit(1)
print("✅ 모두 통과")
