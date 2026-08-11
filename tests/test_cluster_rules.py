"""
무리 규칙 시험 — 2026-08-11 대표님 두 가지 지시.

  ① "온라인 3사에 등록된 건데, 짝을 4개 넘긴 건 잘못 등록된다는 거지?
      기본적으로 짝이 4개를 넘기게끔 세팅하면 안 돼."

  ② "2개는 묶여있는데 1개가 부족한 상황에서 그 1개라고 추정할 수 있는
      도서가 있다면, 이건 사실상 하나의 도서로 봐도 괜찮지 않을까?
      엄격한 규칙으로 짝을 다 맞추고 난 후에 … 어느 정도 유사성을
      보인다면, 그 경우에 한해서는 해도 된다는 말이지."

【왜 시험이 꼭 필요한가요?】
②는 **일부러 규칙을 푸는** 기능입니다. 푸는 기능은 잘못 만들면 아무거나
갖다 붙이는데, 화면에는 그냥 '묶였다' 고만 나옵니다. 아무도 못 알아챕니다.
그래서 **붙이면 안 되는 경우**를 더 많이 시험합니다.

실행: python tests/test_cluster_rules.py
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

from common import config as cfg  # noqa: E402
from common.normalize import normalize_title  # noqa: E402
from run_match import fill_missing_store, split_same_store  # noqa: E402

MCFG = cfg.load("matching.yaml")
failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


def book(i: int, store: int, title: str, *, author="홍길동",
         pub="민음사", ym="2026-05", price=18000) -> dict:
    t = normalize_title(title, MCFG.get("edition_words"),
                        MCFG.get("edition_canonical"))
    return {
        "id": i, "store_id": store,
        "norm_title": t["core"], "norm_subtitle": t["subtitle"],
        "norm_author": author, "norm_publisher": pub, "pub_ym": ym,
        "isbn13": None, "edition_tags": t["editions"],
        "set_volumes": t["set_volumes"], "list_price": price,
    }


def norm(parts):
    return sorted(sorted(p) for p in parts)


# =============================================================================
print("\n[1] ① 한 서점 상품이 두 번 들어간 무리를 갈라낸다")
# 교보(1) 두 권 + 예스24(2) 한 권 → 4권이 되면 안 됩니다
by_id = {
    1: book(1, 1, "달러구트 꿈 백화점"),
    2: book(2, 1, "달러구트 꿈 백화점"),      # 같은 교보에 또 있음
    3: book(3, 2, "달러구트 꿈 백화점"),
}
score = {(1, 3): 100.0, (2, 3): 70.0, (1, 2): 0.0}
parts = split_same_store([1, 2, 3], by_id, score)
check("갈라진다", len(parts) == 2, norm(parts))
check("점수가 높은 쪽이 남는다", [1, 3] in norm(parts), norm(parts))
check("밀려난 것은 혼자가 된다", [2] in norm(parts), norm(parts))

print("\n[1-1] 서점마다 한 권씩이면 손대지 않는다")
ok3 = {1: book(1, 1, "가"), 2: book(2, 2, "가"), 3: book(3, 3, "가")}
check("3권 그대로", split_same_store([1, 2, 3], ok3, {}) == [[1, 2, 3]],
      split_same_store([1, 2, 3], ok3, {}))

print("\n[1-2] 🚨 어떤 경우에도 4권이 남지 않는다")
big = {i: book(i, (i % 3) + 1, "가") for i in range(1, 8)}   # 7권, 서점 3곳
out = split_same_store(list(big), big, {})
check("가장 큰 조각이 3권 이하", max(len(p) for p in out) <= 3, out)
kept = out[0]
check("그 조각 안에 같은 서점이 없다",
      len({big[i]["store_id"] for i in kept}) == len(kept), kept)


# =============================================================================
print("\n[2] ② 2권짜리 무리에 남은 한 권을 채운다")
by_id2 = {
    1: book(1, 1, "원소 원정대"),
    2: book(2, 2, "원소 원정대"),
    3: book(3, 3, "원소 원정대: 118개 캐릭터로 마스터하는 주기율표 공략집"),
}
clusters = {1: [1, 2], 3: [3]}
out2, n = fill_missing_store(dict(clusters), by_id2, MCFG, set())
check("한 종이 채워졌다", n == 1, n)
check("세 권이 한 무리가 됐다", sorted(out2.get(1, [])) == [1, 2, 3], out2)
check("혼자였던 무리는 사라졌다", 3 not in out2, out2)

print("\n[3] 🚨 붙이면 안 되는 경우 — 여기가 진짜 시험입니다")

# (가) 이미 있는 서점이면 채울 자리가 아닙니다 (4권 방지)
same_store = {1: book(1, 1, "가"), 2: book(2, 2, "가"), 3: book(3, 1, "가")}
_, n_a = fill_missing_store({1: [1, 2], 3: [3]}, same_store, MCFG, set())
check("이미 있는 서점 것은 안 붙인다", n_a == 0, n_a)

# (나) 정가가 다르면 안 붙입니다
price_diff = {
    1: book(1, 1, "가나다라"), 2: book(2, 2, "가나다라"),
    3: book(3, 3, "가나다라", price=22000),
}
_, n_b = fill_missing_store({1: [1, 2], 3: [3]}, price_diff, MCFG, set())
check("정가가 다르면 안 붙인다", n_b == 0, n_b)

# (다) 사람이 '다른 책' 이라고 한 짝은 절대 안 붙입니다
_, n_c = fill_missing_store({1: [1, 2], 3: [3]}, by_id2, MCFG, {(1, 3)})
check("사람이 '다른 책' 이라 한 것은 안 붙인다", n_c == 0, n_c)

# (라) 무리의 한 권과만 닮고 다른 한 권과 안 닮으면 안 붙입니다
half = {
    1: book(1, 1, "가나다라마바"),
    2: book(2, 2, "가나다라마바", author="다른저자", pub="창비"),
    3: book(3, 3, "가나다라마바"),
}
_, n_d = fill_missing_store({1: [1, 2], 3: [3]}, half, MCFG, set())
check("두 권 모두와 맞아야 붙인다", n_d == 0, n_d)

# (마) 이미 3권이면 손대지 않습니다
three = {i: book(i, i, "가나다라") for i in (1, 2, 3)}
three[4] = book(4, 1, "가나다라")
_, n_e = fill_missing_store({1: [1, 2, 3], 4: [4]}, three, MCFG, set())
check("3권짜리에는 손대지 않는다", n_e == 0, n_e)

# (바) 제목이 아예 다르면 안 붙입니다
other = {
    1: book(1, 1, "달러구트 꿈 백화점"), 2: book(2, 2, "달러구트 꿈 백화점"),
    3: book(3, 3, "완전히 다른 제목의 책"),
}
_, n_f = fill_missing_store({1: [1, 2], 3: [3]}, other, MCFG, set())
check("제목이 다르면 안 붙인다", n_f == 0, n_f)

print("\n[4] 설정으로 끌 수 있다")
off = dict(MCFG)
off["thresholds"] = dict(MCFG["thresholds"], fill_min_score=0)
_, n_off = fill_missing_store({1: [1, 2], 3: [3]}, by_id2, off, set())
check("fill_min_score 를 0 으로 두면 아무것도 안 한다", n_off == 0, n_off)


print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    for f in failures:
        print(f"   · {f}")
    raise SystemExit(1)
print("✅ 모두 통과")
