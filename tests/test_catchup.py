"""
🚨 '따라잡기' 수집이 제대로 판단하는지 시험.

【2026-09-01 대표님 지적】
  "계속 자동 수집 시간이 늦어지고 있어."

GitHub 예약은 정시에 안 옵니다. 실제로 예정 08:00 인 작업이
10:02 · 10:07 · 10:38 · 13:03 · 15:31 에 돌았습니다.
그리고 **아예 안 온 날도 있습니다** — 2주 사이 8/26 과 8/31 이 통째로
빠졌습니다. 서점은 '오늘' 순위만 보여 주므로 그날 자료는 영영 없습니다.

그래서 아침 9시 11분에 한 번 더 걸어 두고, 이미 받은 서점은 빼고
못 받은 것만 돌립니다.

🚨 여기서 틀리면 두 방향 다 나쁩니다.
   · 받았는데 '안 받았다' 로 보면 → 서점에 요청을 두 번 보냅니다 (무례)
   · 안 받았는데 '받았다' 로 보면 → **그날 자료가 통째로 빕니다** (더 나쁨)
   둘 다 아무 표시가 안 나서 사람은 못 잡습니다.

실행: python tests/test_catchup.py
※ 인터넷도 데이터베이스도 필요 없습니다.
"""

from __future__ import annotations

import os
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

_fake = types.ModuleType("supabase")
_fake.Client = object
_fake.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _fake)

import plan_stores  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


# ---------------------------------------------------------------------------
#  가짜 데이터베이스 — crawl_logs 만 흉내 냅니다
# ---------------------------------------------------------------------------
STORES_ROWS = [{"id": 1, "code": "kyobo"},
               {"id": 2, "code": "yes24"},
               {"id": 3, "code": "aladin"}]


class FakeQ:
    def __init__(self, rows, boom=False):
        self.rows, self.boom = rows, boom

    def select(self, *a, **k):
        return self

    def eq(self, *a, **k):
        return self

    def execute(self):
        if self.boom:
            raise RuntimeError("접속 안 됨")
        return types.SimpleNamespace(data=self.rows)


def run(rows, *, catchup=True, only="", boom=False) -> list[str]:
    """plan_stores 를 돌리고 고른 서점 목록을 돌려줍니다."""
    fake_db = types.ModuleType("common.db")
    fake_db.connect = lambda: types.SimpleNamespace(
        table=lambda n: FakeQ(STORES_ROWS if n == "stores" else rows, boom)
    )
    sys.modules["common.db"] = fake_db

    out_path = ROOT / ".catchup-test-out"
    if out_path.exists():
        out_path.unlink()
    os.environ["GITHUB_OUTPUT"] = str(out_path)
    os.environ["CATCHUP"] = "true" if catchup else "false"
    os.environ["ONLY_STORE"] = only
    try:
        plan_stores.main()
        text = out_path.read_text(encoding="utf-8")
    finally:
        out_path.unlink(missing_ok=True)
        os.environ.pop("GITHUB_OUTPUT", None)
    import json
    return json.loads(text.split("stores=", 1)[1].strip())


ALL = ["kyobo", "yes24", "aladin"]
ID = {"kyobo": 1, "yes24": 2, "aladin": 3}


def logs(**per_store) -> list[dict]:
    """{'kyobo': 15000, 'yes24': 0} → crawl_logs 흉내"""
    out = []
    for name, n in per_store.items():
        out.append({"store_id": ID[name], "status": "success" if n else "failed",
                    "items_collected": n})
    return out


# ---------------------------------------------------------------------------
print("\n[1] 평소 실행은 예전 그대로 (전부 돈다)")
check("따라잡기가 아니면 3사 전부", run([], catchup=False) == ALL, run([], catchup=False))
check("한 서점만 지정하면 그것만",
      run([], catchup=False, only="aladin") == ["aladin"])


# ---------------------------------------------------------------------------
print("\n[2] 따라잡기 — 못 받은 것만 돕니다")
check("아무것도 못 받았으면 전부",
      run([]) == ALL, run([]))
check("알라딘만 빠졌으면 알라딘만",
      run(logs(kyobo=15000, yes24=21000)) == ["aladin"],
      run(logs(kyobo=15000, yes24=21000)))
check("🚨 3사 다 받았으면 아무것도 안 함",
      run(logs(kyobo=15000, yes24=21000, aladin=23000)) == [],
      "여기서 빈 목록이 아니면 서점에 두 번 요청합니다")
check("둘이 빠졌으면 둘만",
      run(logs(kyobo=15000)) == ["yes24", "aladin"],
      run(logs(kyobo=15000)))


# ---------------------------------------------------------------------------
print("\n[3] 🚨 '실패한 기록' 을 '받았다' 로 세지 않는다")
"""
실패해도 crawl_logs 에는 줄이 남습니다. 기록이 있다고 받았다고 보면
**실패한 날을 영영 안 고칩니다.** 이게 제일 위험한 착각입니다.
"""
check("실패 기록만 있으면 다시 돈다",
      run([{"store_id": 3, "status": "failed", "items_collected": 0}]) == ALL,
      run([{"store_id": 3, "status": "failed", "items_collected": 0}]))
check("🚨 성공인데 0권이면 받은 걸로 안 본다",
      "aladin" in run([{"store_id": 3, "status": "success", "items_collected": 0}]))
check("몇 권 안 되면(100권 미만) 받은 걸로 안 본다",
      "aladin" in run(logs(aladin=50)), run(logs(aladin=50)))
check("100권 넘으면 받은 걸로 본다",
      "aladin" not in run(logs(kyobo=15000, yes24=21000, aladin=150)))


# ---------------------------------------------------------------------------
print("\n[4] 🚨 확인을 못 하면 '안 하기' 가 아니라 '하기'")
"""
데이터베이스에 못 물어본 날 '모르니까 건너뛴다' 로 하면, 물어보기가
실패한 날은 수집도 안 됩니다. 한 번 더 받는 쪽이 훨씬 낫습니다.
"""
check("물어보기 실패하면 전부 돈다", run([], boom=True) == ALL, run([], boom=True))


# ---------------------------------------------------------------------------
print("\n[5] 작업 파일이 이 판단을 실제로 쓰는가")
wf = (ROOT / ".github" / "workflows" / "daily-crawl.yml").read_text(encoding="utf-8")

check("따라잡기 예약이 걸려 있다", 'cron: "11 0 * * *"' in wf)
check("평소 예약이 정각을 피했다", 'cron: "17 21 * * *"' in wf)
check("두 예약을 구분해서 따라잡기로 넘긴다",
      "github.event.schedule == '11 0 * * *'" in wf,
      "이게 없으면 평소 실행까지 건너뛰게 됩니다")
check("판단을 plan_stores.py 가 한다", "crawler/plan_stores.py" in wf)
check("🚨 할 일이 없으면 수집을 아예 안 시작한다",
      "needs.plan.outputs.stores != '[]'" in wf)
check("할 일이 없는 날은 용량도 안 잰다",
      wf.count("needs.plan.outputs.stores != '[]'") >= 2,
      "하루에 두 줄이 남으면 '날짜별' 표가 이상해집니다")

# 손으로 누른 것은 따라잡기가 아닙니다 (그때는 무조건 돌아야 합니다)
check("손으로 누르면 따라잡기가 아니다",
      "github.event.schedule ==" in wf and "workflow_dispatch" in wf)


# ---------------------------------------------------------------------------
print("\n[6] 예약이 전부 정각을 피했는가 (붐비는 시각)")
wfdir = ROOT / ".github" / "workflows"
on_hour = []
for f in sorted(wfdir.glob("*.yml")):
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("- cron:"):
            minute = line.split('"')[1].split()[0]
            if minute == "0":
                on_hour.append(f"{f.name} {line}")
check("정각(0분)에 걸린 예약이 없다", not on_hour, on_hour)


# ---------------------------------------------------------------------------
print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    raise SystemExit(1)
print("✅ 모두 통과")
