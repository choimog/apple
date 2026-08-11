"""
'한 책에 다른 출판사가 섞였나' 검사가 **사람 결정을 잘못으로 세지 않는지** 시험.

【왜 필요한가요? — 2026-08-11】
대표님이 『어떻게 살아낼 것인가』를 '같은 책' 으로 체크하신 것이 출판사
표기 때문에 취소되던 문제를 고쳤습니다. 그랬더니 이번에는 매칭 뒤 검사가
2,325건을 '잘못' 이라며 빨간불을 냈습니다.

목록을 보니 이런 것들이었습니다.

    YBM / 와이비엠 / YBM(와이비엠)
    PAGODA Books / 파고다북스 / 파고다
    EJONG(이종문화사) / EJONG / 도서출판이종

글자로만 보면 0% 닮았지만(한글·영문이라 그렇습니다) **실제로는 같은
출판사**입니다. 기계는 알 수 없고 사람은 압니다.

이걸 '잘못' 으로 세면 대표님이 옳게 판단하실수록 검사가 빨간불이 되고,
진짜 고장이 그 속에 묻힙니다. 그래서 사람이 이어 놓은 것은 통과시키되
숫자는 반드시 보여 드리도록 고쳤습니다.

⚠️ 다만 **아무거나 통과시키면 안 됩니다.** 사람이 정한 것 말고 기계가
   잘못 이어 붙인 부분이 남아 있으면 여전히 잡아야 합니다.
   그 경계를 여기서 지킵니다.

실행: python tests/test_verify_publishers.py
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

from verify_publishers import joined_by_person  # noqa: E402

FLOOR = 0.80
failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


def m(i: int, pub: str | None) -> dict:
    return {"id": i, "norm_publisher": pub, "raw_publisher": pub}


def adj(*pairs: tuple[int, int]) -> dict[int, set[int]]:
    out: dict[int, set[int]] = {}
    for a, b in pairs:
        out.setdefault(a, set()).add(b)
        out.setdefault(b, set()).add(a)
    return out


# -----------------------------------------------------------------------------
print("\n[1] 대표님 사례 — 필름(Feelm) / 필름")
members = [m(1, "필름feelm"), m(2, "필름"), m(3, "필름feelm")]
names = ["필름feelm", "필름"]
check("사람이 다 이었으면 통과",
      joined_by_person(members, names, FLOOR, adj((1, 2), (2, 3), (1, 3))) is True)
check("한 짝만 이어도 통과 (그것으로 두 편이 이어짐)",
      joined_by_person(members, names, FLOOR, adj((1, 2))) is True)

print("\n[2] 🚨 사람이 안 이은 것은 통과시키지 않는다")
check("체크가 하나도 없으면 잡는다",
      joined_by_person(members, names, FLOOR, {}) is False)
check("엉뚱한 짝만 있으면 잡는다",
      joined_by_person(members, names, FLOOR, adj((7, 8))) is False)
# 1─3 은 같은 출판사끼리라 편을 잇지 못합니다
check("같은 편 안에서만 이은 것은 소용없다",
      joined_by_person(members, names, FLOOR, adj((1, 3))) is False)

print("\n[3] 🚨 일부만 이어졌으면 잡는다 (가장 중요)")
# 세 출판사: A · B · C. 사람은 A─B 만 이었고 C 는 기계가 잘못 붙였습니다.
three = [m(1, "민음사"), m(2, "미음사이오"), m(3, "문학동네")]
names3 = ["민음사", "미음사이오", "문학동네"]
check("A─B 만 이었으면 C 때문에 여전히 잡힌다",
      joined_by_person(three, names3, FLOOR, adj((1, 2))) is False)
check("A─B, B─C 를 다 이으면 통과",
      joined_by_person(three, names3, FLOOR, adj((1, 2), (2, 3))) is True)

print("\n[4] 다른 책의 결정이 끼어들지 않는다")
# 4번은 이 책에 없는 책입니다. 그걸로 이어진 척하면 안 됩니다.
check("이 책 밖의 짝은 무시한다",
      joined_by_person(members, names, FLOOR, adj((1, 4), (4, 2))) is False)

print("\n[5] 출판사를 모르는 책이 섞여 있어도 안 터진다")
mixed = [m(1, "필름feelm"), m(2, None), m(3, "필름")]
check("모르는 것은 편을 못 이어 준다",
      joined_by_person(mixed, ["필름feelm", "필름"], FLOOR, adj((1, 2), (2, 3))) is False)
check("아는 것끼리 이으면 통과",
      joined_by_person(mixed, ["필름feelm", "필름"], FLOOR, adj((1, 3))) is True)

print("\n[6] 한글·영문 표기가 같은 출판사인 경우 (실제 사례)")
ybm = [m(1, "ybm"), m(2, "와이비엠"), m(3, "ybm와이비엠")]
names6 = ["ybm", "와이비엠", "ybm와이비엠"]
check("사람이 이으면 통과",
      joined_by_person(ybm, names6, FLOOR, adj((1, 2), (2, 3))) is True)
check("안 이으면 잡는다", joined_by_person(ybm, names6, FLOOR, {}) is False)


print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    for f in failures:
        print(f"   · {f}")
    raise SystemExit(1)
print("✅ 모두 통과")
