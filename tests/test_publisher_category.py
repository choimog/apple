"""
🚨 괄호 안의 '분류' 를 '다른 이름' 으로 잘못 읽지 않는지 봅니다.

【2026-08-18 — 실제 매칭 기록에서 발견】

대표님이 "매일 수집이랑 도서 매칭은 돌렸던 것 같은데?" 하고 물으셔서
실행 기록을 확인하다가 찾았습니다. 로그에 이렇게 찍혀 있었습니다.

    · 출판사 — 표기 6,696가지를 5,594곳으로 모았습니다
        학산문화사 ← NE능률 · YNK MEDIA · 교보문고 · 교우사 · 군자출판사
                     · 글담 · 꿈을담는틀 · 메가스터디북스 · 삼원북스
                     · 수경출판사 · 시공사 · 지학사 · 키움 · 한빛아카데미
                     · 해냄에듀 …

전혀 남남인 출판사 수십 곳이 한 줄로 합쳐졌습니다.

【원인】
괄호 안을 **다른 이름**이라고만 가정했습니다.

    YBM(와이비엠)   →  '와이비엠' 도 같은 곳     ✅ 맞습니다

그런데 교보문고는 출판사 이름에 **분류**를 괄호로 붙입니다.

    지학사(참고서) · NE능률(참고서)   →  '참고서' 가 겹침 → 닮은 정도 1.00

'참고서' 가 '교재' 로, '교재' 가 '만화' 로 줄줄이 이어져 한 덩어리가
됐습니다. '참고서' 는 네 곳에서만 겹쳐서 흔한 낱말 검사(8곳)에도
안 걸렸습니다.

【무엇이 틀어졌나】
  · 웰컴의 [출판사 TOP 8] 과 출판사별 화면이 그대로 틀립니다
  · 매칭에서 '출판사가 다르니 다른 책' 이라는 갈라내기가 안 먹습니다
  · 🚨 확인 도구(verify_publishers)는 **같은 잣대**를 써서 "0건" 이라고
       답했습니다. 자기 눈으로는 못 보는 고장이라 여기서 잡습니다.

실행: python tests/test_publisher_category.py
※ 인터넷도 DB 도 필요 없습니다.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

from common.match import (  # noqa: E402
    publisher_categories, publisher_similarity, publisher_variants,
    set_publisher_aliases, set_publisher_categories,
)
from common.names import alias_groups, canonical_map  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


print("\n[1] 🚨 분류가 겹친다고 남남인 출판사가 같아지면 안 됩니다")
# 2026-08-18 로그의 그 덩어리에서 실제로 뽑은 짝들입니다.
for a, b in [
    ("지학사(참고서)", "NE능률(참고서)"),
    ("메가스터디북스(참고서)", "해냄에듀(참고서)"),
    ("교보문고(교재)", "군자출판사(교재)"),
    ("시공사(만화)", "학산문화사(만화)"),
    ("인디고(만화)", "대원씨아이(만화)"),
    ("키움(학습)", "디딤돌교육(학습)"),
    ("시공사(잡지)", "지학사(잡지)"),
    ("한국교육방송공사(기타)", "교보문고(기타)"),
    ("교보문고(단행본)", "해냄에듀(단행본)"),
    ("삼원북스(수험서)", "한빛아카데미(교재)"),
]:
    got = publisher_similarity(a, b)
    check(f"{a} ≠ {b}", got < 0.80, round(got, 2))

print("\n[2] 🚨 진짜 다른 이름은 그대로 이어져야 합니다 (고치다 부수면 안 됩니다)")
for a, b in [
    ("YBM(와이비엠)", "와이비엠"),
    ("YBM(와이비엠)", "YBM"),
    ("윌북(willbook)", "윌북"),
    ("필름(Feelm)", "필름"),
    ("중앙books(중앙북스)", "중앙북스"),
    ("시리얼(학산문화사)", "학산문화사"),
    ("청어람Life(청어람미디어)", "청어람미디어"),
]:
    got = publisher_similarity(a, b)
    check(f"{a} = {b}", got >= 0.80, round(got, 2))

print("\n[3] 🚨 괄호 밖 이름으로는 여전히 이어집니다 (잃는 것이 없다는 증거)")
# 이게 안 되면 교보의 '지학사(참고서)' 가 예스24의 '지학사' 와 갈라집니다.
# 그건 대표님이 처음에 지적하신 바로 그 문제입니다.
for a, b in [
    ("지학사(참고서)", "지학사"),
    ("학산문화사(만화)", "학산문화사"),
    ("교보문고(교재)", "교보문고"),
    ("대원씨아이(단행본)", "대원씨아이"),
]:
    got = publisher_similarity(a, b)
    check(f"{a} = {b}", got >= 0.80, round(got, 2))

print("\n[4] 분류어는 후보에서 빠지고, 괄호 밖 이름은 남습니다")
v = publisher_variants("지학사(참고서)")
check("'참고서' 가 후보에서 빠졌다", "참고서" not in v, v)
check("'지학사' 는 남았다", "지학사" in v, v)
check("원래 글자도 남았다", "지학사(참고서)" in v, v)
v2 = publisher_variants("YBM(와이비엠)")
check("분류어가 아니면 그대로 후보 (와이비엠)", "와이비엠" in v2, v2)

print("\n[5] 🚨 설정을 비워도 기본 목록은 살아 있어야 합니다")
# 설정 한 줄 지웠다고 지학사와 NE능률이 다시 같은 출판사가 되면 안 됩니다.
for arg in (None, [], ["", "  "]):
    set_publisher_categories(arg)
    got = publisher_similarity("지학사(참고서)", "NE능률(참고서)")
    check(f"설정이 {arg!r} 여도 안 이어진다", got < 0.80, round(got, 2))
check("기본 목록에 참고서·교재·만화가 들어 있다",
      {"참고서", "교재", "만화", "잡지", "학습", "기타"} <= publisher_categories())

print("\n[6] 설정에 적으면 더해집니다 (기본을 밀어내지 않습니다)")
set_publisher_categories(["오판근"])
check("새로 적은 말이 들어갔다", "오판근" in publisher_categories())
check("기본 목록도 그대로", "참고서" in publisher_categories())
check("교우사(오판근) 와 교우사(교재) 가 안 이어진다",
      publisher_similarity("교우사(오판근)", "군자출판사(교재)") < 0.80)
set_publisher_categories(None)

print("\n[7] 🚨 화면 이름 묶기 — 그 덩어리가 다시 생기지 않는가")
# 로그에 나온 이름들을 그대로 넣어 봅니다.
names = [
    "학산문화사", "학산문화사(만화)", "학산문화사(잡지)", "학산문화사(단행본)",
    "지학사", "지학사(참고서)", "지학사(잡지)", "지학사(학습)",
    "NE능률", "NE능률(참고서)",
    "시공사", "시공사(만화)", "시공사(잡지)",
    "교보문고", "교보문고(교재)", "교보문고(단행본)",
    "메가스터디북스", "메가스터디북스(참고서)",
    "군자출판사", "군자출판사(교재)",
    "한빛아카데미", "한빛아카데미(교재)",
]
groups, ignored = alias_groups(names)
by_name = {}
for g in groups:
    for i in g:
        by_name[names[i]] = min(g)

pairs_apart = [
    ("학산문화사", "지학사"),
    ("학산문화사", "NE능률"),
    ("지학사", "NE능률"),
    ("시공사", "교보문고"),
    ("메가스터디북스", "군자출판사"),
    ("한빛아카데미", "교보문고"),
]
for a, b in pairs_apart:
    check(f"{a} 와 {b} 는 딴 무리", by_name[a] != by_name[b],
          (a, by_name[a], b, by_name[b]))

pairs_together = [
    ("학산문화사", "학산문화사(만화)"),
    ("학산문화사", "학산문화사(잡지)"),
    ("지학사", "지학사(참고서)"),
    ("NE능률", "NE능률(참고서)"),
    ("교보문고", "교보문고(교재)"),
]
for a, b in pairs_together:
    check(f"{a} 와 {b} 는 한 무리", by_name[a] == by_name[b],
          (a, by_name[a], b, by_name[b]))

check("🚨 가장 큰 무리가 4개를 안 넘는다 (학산문화사 4가지)",
      max(len(g) for g in groups) <= 4, sorted(map(len, groups), reverse=True))

print("\n[8] 🚨 온전한 이름이 아닌 조각은 다리로 안 씁니다 (두 번째 방어선)")
# 제가 목록에 못 적은 분류어가 나와도 막혀야 합니다.
#  '어쩌구저쩌구' 는 제 목록에 없는 가짜 분류어입니다.
odd = ["가나출판(어쩌구저쩌구)", "다라출판(어쩌구저쩌구)"]
g2, _ = alias_groups(odd)
check("목록에 없는 말이어도 안 이어진다", len(g2) == 2, g2)
# 반대로 온전한 이름이면 이어집니다
ok = ["가나출판(다라출판)", "다라출판"]
g3, _ = alias_groups(ok)
check("온전한 이름이면 이어진다", len(g3) == 1, g3)

print("\n[9] 대표님이 직접 정하신 것은 이 규칙보다 먼저입니다")
# 청림Life / 청림라이프 는 글자로는 안 잡힙니다. 사람 결정이 우선입니다.
declared = {"청림life": "청림라이프", "청림라이프": "청림라이프"}
set_publisher_aliases(declared)
check("청림Life = 청림라이프", publisher_similarity("청림life", "청림라이프") >= 0.80)
check("청림출판은 여전히 딴 곳",
      publisher_similarity("청림출판", "청림라이프") < 0.80)
g4, _ = alias_groups(["청림life", "청림라이프", "청림출판"], declared=declared)
check("화면 이름도 한 무리", len(g4) == 2, g4)
set_publisher_aliases(None)

print("\n[10] 실제로 화면 이름표가 바뀌는지 (canonical_map)")
pairs = [
    ("지학사(참고서)", "지학사(참고서)"),
    ("지학사", "지학사"),
    ("ne능률(참고서)", "NE능률(참고서)"),
]
canon, _, _ = canonical_map(pairs, use_alias=True)
check("지학사(참고서) → 지학사", canon["지학사(참고서)"] == "지학사", canon)
check("🚨 NE능률이 지학사로 안 바뀐다",
      canon["ne능률(참고서)"] != "지학사", canon)

print("\n[11] 설정 파일과 코드가 어긋나지 않는가")
import yaml  # noqa: E402

mc = yaml.safe_load((ROOT / "config" / "matching.yaml").read_text(encoding="utf-8"))
check("matching.yaml 에 publisher_category_words 칸이 있다",
      "publisher_category_words" in mc, list(mc)[-5:])
src = (ROOT / "crawler" / "run_match.py").read_text(encoding="utf-8")
check("🚨 매칭이 그 설정을 실제로 읽는다",
      "set_publisher_categories(mcfg.get(\"publisher_category_words\"))" in src,
      "안 읽으면 설정이 장식이 됩니다")
ver = (ROOT / "crawler" / "verify_publishers.py").read_text(encoding="utf-8")
check("🚨 확인 도구도 같은 목록을 쓴다",
      "set_publisher_categories(" in ver,
      "잣대가 다르면 멀쩡한 것을 신고하거나, 고장을 못 봅니다")

print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    for f in failures:
        print(f"   · {f}")
    raise SystemExit(1)
print("✅ 모두 통과")
