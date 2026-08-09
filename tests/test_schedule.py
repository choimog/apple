"""
자동 작업들이 서로 제대로 이어져 있는지 시험.

【왜 필요한가요? — 2026-08-09】
"수집 → 매칭 → 시트 → 리포트" 를 **시각이 아니라 사슬로** 이어 붙였습니다.
앞 작업이 끝나면 다음이 바로 시작합니다.

그런데 이 사슬은 **작업 이름을 글자로 적어서** 연결합니다.
이름을 한 글자라도 고치면 사슬이 조용히 끊깁니다 —
빨간 X 도 안 뜨고, 그냥 리포트가 안 나옵니다. 며칠 지나야 압니다.

그래서 여기서 "적어 놓은 이름" 과 "실제 작업 이름" 이 같은지 봅니다.

실행: python tests/test_schedule.py
"""

from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
WF = ROOT / ".github" / "workflows"

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


def load(fname: str) -> dict:
    # ⚠️ YAML 에서 'on:' 은 참/거짓(True)으로 읽힙니다. 그래서 키가
    #    문자열 "on" 이 아니라 True 인 경우가 있습니다. 둘 다 봅니다.
    return yaml.safe_load((WF / fname).read_text(encoding="utf-8"))


def triggers(doc: dict) -> dict:
    return doc.get("on") or doc.get(True) or {}


# 실제 파일에 적힌 이름들을 먼저 모읍니다
names: dict[str, str] = {}
for f in sorted(WF.glob("*.yml")):
    doc = yaml.safe_load(f.read_text(encoding="utf-8"))
    names[f.name] = str(doc.get("name", ""))


print("\n[1] 사슬이 실제 작업 이름을 가리키는지")
# (이 파일이) → (이 작업이 끝나면 시작)
CHAIN = {
    "match.yml": "daily-crawl.yml",
    "export-sheets.yml": "match.yml",
    "report.yml": "match.yml",
}
for child, parent in CHAIN.items():
    doc = load(child)
    wr = triggers(doc).get("workflow_run") or {}
    listed = wr.get("workflows") or []
    want = names[parent]
    check(
        f"{names[child]} ← {want}",
        listed == [want],
        f"적혀 있는 이름 {listed} · 실제 이름 '{want}'",
    )
    check(f"  {names[child]} 은 '끝났을 때' 로 걸려 있음",
          wr.get("types") == ["completed"], wr.get("types"))


print("\n[2] 사슬이 끊겼을 때를 대비한 보험(예약 시각)이 남아 있는지")
# 사슬 하나만 믿으면, 그게 안 걸린 날 아무 일도 안 일어난 걸 모르고 지나갑니다.
for f in ["match.yml", "export-sheets.yml", "report.yml"]:
    sched = triggers(load(f)).get("schedule") or []
    check(f"{names[f]} 에 예약 시각이 남아 있음", len(sched) >= 1, sched)


print("\n[3] '성공했을 때만' 으로 막아 두지 않았는지")
# ⚠️ 수집 작업 안에는 [용량 확인] 이 같이 들어 있습니다. 저장공간이
#    한도에 가까우면 수집은 멀쩡해도 전체가 '실패' 로 표시됩니다.
#    'success 일 때만' 으로 걸어 두면, 용량 경고가 뜬 날은 리포트까지
#    통째로 안 나옵니다. 그 실수를 막습니다.
for f in CHAIN:
    text = (WF / f).read_text(encoding="utf-8")
    check(f"{names[f]} 이 conclusion == 'success' 로 막지 않음",
          "conclusion == 'success'" not in text)
    check(f"  {names[f]} 이 취소된 경우는 건너뜀",
          "conclusion != 'cancelled'" in text)


print("\n[4] 예약 시각이 한국시간으로 말이 되는지")
# GitHub 은 세계표준시(UTC)로 돕니다. 한국시간은 +9 입니다.
def kst(cron: str) -> str:
    m, h = cron.split()[0], cron.split()[1]
    return f"{(int(h) + 9) % 24:02d}:{int(m):02d}"


WANT = {
    "daily-crawl.yml": "06:00",
    "match.yml": "09:00",
    "export-sheets.yml": "10:00",
    "report.yml": "10:30",
}
for f, want in WANT.items():
    sched = triggers(load(f)).get("schedule") or []
    got = [kst(s["cron"]) for s in sched]
    check(f"{names[f]} 예약 = 한국시간 {want}", got == [want], got)


print("\n[5] 같은 작업이 겹쳐 돌지 않게 막아 뒀는지")
# 사슬과 예약이 같은 날 둘 다 걸릴 수 있습니다. 겹치면 안 됩니다.
for f in ["daily-crawl.yml", "match.yml", "export-sheets.yml", "report.yml"]:
    doc = load(f)
    con = doc.get("concurrency") or {}
    check(f"{names[f]} 에 겹침 방지가 있음", bool(con.get("group")), con)


print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    for x in failures:
        print(f"   · {x}")
    raise SystemExit(1)
print("✅ 모두 통과")
