"""
표지 주소에서 ISBN 을 찾아내는 규칙 시험.

【왜 이 시험이 중요한가요? — 2026-08-11】
ISBN 이 양쪽에 있으면 매칭이 **확정**됩니다. 제목·저자를 볼 것도 없이
같은 책으로 묶습니다. 그래서 **잘못된 ISBN 하나가 엉뚱한 두 책을 영원히
한 권으로 만듭니다.** 빈 값보다 훨씬 나쁩니다.

주소 안의 숫자를 아무거나 ISBN 이라고 세면 안 됩니다.
예스24 표지 주소의 192474512 는 **상품번호**입니다.
알라딘의 39802/11 도 내부 번호입니다.

그래서 검사식(체크섬)까지 맞는 것만 ISBN 으로 봅니다.
이 시험은 그 경계를 지킵니다.

실행: python tests/test_probe_isbn.py
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

from probe_isbn import (  # noqa: E402
    find_isbn, isbn10_ok, isbn13_ok, scan_html, to_isbn13,
)

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


print("\n[1] 검사식 — 진짜 ISBN 만 통과")
check("ISBN13 맞음 (9791199489561)", isbn13_ok("9791199489561"))
check("ISBN13 맞음 (9788932917245)", isbn13_ok("9788932917245"))
# 마지막 자리 하나만 바꾸면 떨어져야 합니다
check("마지막 자리가 틀리면 떨어짐", not isbn13_ok("9791199489562"))
check("13자리가 아니면 떨어짐", not isbn13_ok("979119948956"))
check("숫자가 아니면 떨어짐", not isbn13_ok("97911994895ab"))

check("ISBN10 맞음 (8932917248)", isbn10_ok("8932917248"), )
check("ISBN10 마지막이 X 인 경우", isbn10_ok("043942089X"))
check("ISBN10 틀리면 떨어짐", not isbn10_ok("8932917241"))
check("10자리가 아니면 떨어짐", not isbn10_ok("893291724"))

print("\n[2] ISBN10 → ISBN13 바꾸기")
check("8932917248 → 9788932917245", to_isbn13("8932917248") == "9788932917245",
      to_isbn13("8932917248"))
check("바꾼 값도 검사식을 통과", isbn13_ok(to_isbn13("8932917248")))

print("\n[3] 교보 표지 주소 — 실제로 되는 경우")
kyobo = "https://contents.kyobobook.co.kr/sih/fit-in/300x0/pdt/9791199489561.jpg"
got = find_isbn(kyobo)
check("ISBN13 을 찾아낸다", got is not None and got[0] == "9791199489561", got)

print("\n[4] 🚨 상품번호를 ISBN 이라고 하지 않는다 (가장 중요)")
# 이게 무너지면 엉뚱한 두 책이 영원히 한 권이 됩니다.
yes24 = "https://image.yes24.com/goods/192474512/L"
check("예스24 상품번호는 ISBN 이 아니다", find_isbn(yes24) is None, find_isbn(yes24))

aladin = "https://image.aladin.co.kr/product/39802/11/cover200/k082130602_3.jpg"
check("알라딘 내부 코드도 ISBN 이 아니다", find_isbn(aladin) is None, find_isbn(aladin))

check("긴 숫자 안에 우연히 든 것도 안 센다",
      find_isbn("https://x.com/999888777666555444333/a.jpg") is None,
      find_isbn("https://x.com/999888777666555444333/a.jpg"))
check("자릿수가 어중간하면 안 센다",
      find_isbn("https://x.com/goods/12345678/L") is None)

print("\n[5] 알라딘 옛 방식 (표지 이름이 ISBN10 인 경우)")
# 이런 주소가 실제로 남아 있으면 공짜로 ISBN 을 얻을 수 있습니다.
old = "https://image.aladin.co.kr/product/1234/56/cover/8932917248_1.jpg"
got5 = find_isbn(old)
check("ISBN10 을 찾아 13자리로 바꿔 준다",
      got5 is not None and got5[0] == "9788932917245", got5)
check("어떻게 찾았는지 알려준다", got5 is not None and "10자리" in got5[1], got5)

print("\n[6] HTML 전체 뒤지기 — 표지 말고 다른 자리도 봅니다")
# 목록 페이지에는 표지 말고도 수십 가지 값이 들어 있습니다.
kyobo_html = '<img src="https://contents.kyobobook.co.kr/sih/fit-in/300x0/pdt/9791199489561.jpg">'
check("교보 표지 주소에서 찾는다",
      [g for g, _ in scan_html(kyobo_html)] == ["9791199489561"], scan_html(kyobo_html))

attr = '<li data-isbn="9788932917245" data-goods="12345">책</li>'
check("data-isbn 속성에서도 찾는다",
      [g for g, _ in scan_html(attr)] == ["9788932917245"], scan_html(attr))
check("어디서 찾았는지 앞뒤 글자를 함께 준다",
      "data-isbn" in scan_html(attr)[0][1], scan_html(attr)[0][1])

# 🚨 상품번호가 잔뜩 든 목록에서 하나도 안 잡혀야 합니다
goods = "".join(f'<a href="/goods/{192474512 + i}">책</a>' for i in range(50))
check("상품번호만 잔뜩 있으면 하나도 안 잡는다", scan_html(goods) == [], scan_html(goods)[:3])

# 긴 숫자의 일부를 잘라내 ISBN 이라고 하면 안 됩니다
check("긴 숫자 가운데를 잘라 쓰지 않는다",
      scan_html("<a>97911994895610000</a>") == [], scan_html("<a>97911994895610000</a>"))
check("붙임표로 이어진 번호도 안 자른다",
      scan_html("<a>9791199489561-77</a>") == [], scan_html("<a>9791199489561-77</a>"))

print("\n[7] 빈 값·이상한 값에도 안 터진다")
check("빈 주소", find_isbn("") is None)
check("숫자 없는 주소", find_isbn("https://x.com/cover.jpg") is None)


print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    for f in failures:
        print(f"   · {f}")
    raise SystemExit(1)
print("✅ 모두 통과")
