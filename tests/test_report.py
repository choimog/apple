"""
AI 일일 리포트가 (1) 돈을 넘겨 쓰지 않는지 (2) 없는 사실을 만들지 않는지 시험.

【왜 이 두 가지인가요?】
이 프로그램은 이 프로젝트에서 **돈을 쓰는 유일한 부분**입니다.
그리고 AI 는 자료가 없으면 그럴듯하게 지어내는 성질이 있습니다.
그래서 AI 를 부르기 **전에** 숫자가 맞는지, 한도가 지켜지는지를 봅니다.

(AI 를 실제로 부르지는 않습니다. 시험이 돈을 쓰면 안 됩니다)

실행: python tests/test_report.py
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

_fake_sb = types.ModuleType("supabase")
_fake_sb.Client = object
_fake_sb.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _fake_sb)

# anthropic 은 **있으면 진짜를 씁니다.** (부르지는 않고, 값만 받아주는지 봅니다)
#
# 🚨 예전에는 여기서 무조건 가짜를 끼웠습니다. 그래서 시험이 전부 통과했는데도
#    운영에서 터졌습니다 (2026-08-09). 가짜는 무엇이든 받아주기 때문입니다.
#    진짜가 깔려 있으면 진짜로 확인해야 합니다.
try:
    import anthropic  # noqa: F401

    HAVE_SDK = True
except ImportError:
    HAVE_SDK = False
    _fake_an = types.ModuleType("anthropic")
    _fake_an.__version__ = "(없음)"
    _fake_an.Anthropic = object
    _fake_an.RateLimitError = type("RateLimitError", (Exception,), {})
    _fake_an.APIStatusError = type("APIStatusError", (Exception,), {})
    _fake_an.APIConnectionError = type("APIConnectionError", (Exception,), {})
    sys.modules["anthropic"] = _fake_an

import report_data as rd  # noqa: E402
import run_report as rr  # noqa: E402
from common import config as cfg  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


# -----------------------------------------------------------------------------
#  가짜 데이터베이스 — 진짜에 붙지 않습니다
# -----------------------------------------------------------------------------
def book(bid, title, pub="어떤출판사", stores=3):
    return {
        "book_id": bid, "title": title, "author": "저자",
        "publisher": pub, "store_count": stores,
        "ranks": {"1": 1, "2": 2, "3": 3}, "sales": {},
    }


class FakeRPC:
    def __init__(self, rows):
        self.rows = rows

    def execute(self):
        return types.SimpleNamespace(data=self.rows)


class FakeDB:
    """combined_best / publisher_ranking 만 흉내 냅니다."""

    def __init__(self, by_day: dict, pubs: dict | None = None):
        self.by_day = by_day
        self.pubs = pubs or {}
        self.costs: list[float] = []

    def rpc(self, name, params):
        day = params["p_date"]
        if name == "combined_best":
            rows = self.by_day.get(day, [])
            return FakeRPC(rows[: params["p_limit"]])
        if name == "publisher_ranking":
            rows = self.pubs.get(day, [])
            return FakeRPC(rows[: params["p_limit"]])
        raise AssertionError(f"모르는 함수: {name}")

    # spent_this_month 용
    def table(self, name):
        assert name == "daily_reports"
        return self

    def select(self, *a):
        return self

    def gte(self, *a):
        return self

    def lte(self, *a):
        return self

    def execute(self):
        return types.SimpleNamespace(data=[{"cost_usd": c} for c in self.costs])


CONF = {"top": 5, "compare_depth": 300, "min_stores": 2, "big_move": 20, "publishers": 3}


print("\n[1] 어제 자료가 없으면 '신규 진입' 을 지어내지 않기")
# ⚠️ 여기가 가장 위험한 곳입니다. 어제가 비어 있으면 오늘 전부가
#    '신규 진입' 으로 보입니다. 그대로 AI 에게 주면 첫날에
#    "40권이 새로 진입했습니다" 라는 거짓 리포트가 나옵니다.
db1 = FakeDB({"2026-08-10": [book(1, "가"), book(2, "나")]})
d1 = rd.collect(db1, "2026-08-10", CONF)
check("어제 자료 없음으로 표시", d1["has_yesterday"] is False, d1["has_yesterday"])
check("신규 진입 0건", d1["new_in"] == [], d1["new_in"])
check("상승·하락도 0건", (d1["up"], d1["down"]) == ([], []), (d1["up"], d1["down"]))
t1 = rd.to_text(d1)
check("AI 에게 '변화를 말하지 말라' 고 알림", "어제 자료가 없습니다" in t1)
check("'신규진입' 이라는 말이 안 들어감", "신규진입" not in t1)


print("\n[2] 순위 변화를 실제로 계산하기")
db2 = FakeDB({
    "2026-08-10": [book(1, "가"), book(2, "나"), book(9, "새책")],
    "2026-08-09": [book(2, "나"), book(1, "가")],
})
d2 = rd.collect(db2, "2026-08-10", CONF)
by_title = {r["title"]: r for r in d2["rows"]}
check("어제 자료 있음", d2["has_yesterday"] is True)
check("'가' 2위→1위 = +1", by_title["가"]["change"] == 1, by_title["가"])
check("'나' 1위→2위 = -1", by_title["나"]["change"] == -1, by_title["나"])
check("'새책' 은 어제 없음", by_title["새책"]["prev_rank"] is None, by_title["새책"])
check("신규 진입은 '새책' 하나", [r["title"] for r in d2["new_in"]] == ["새책"], d2["new_in"])


print("\n[3] 크게 움직인 것만 골라내기 (기준 20계단)")
today = [book(i, f"책{i}") for i in range(1, 6)]
# 책5 는 어제 40위 → 오늘 5위 (+35), 책1 은 어제 1위 → 오늘 1위 (0)
yest = [book(1, "책1")] + [book(50 + i, f"기타{i}") for i in range(1, 39)] + [book(5, "책5")]
db3 = FakeDB({"2026-08-10": today, "2026-08-09": yest})
d3 = rd.collect(db3, "2026-08-10", CONF)
ups = [r["title"] for r in d3["up"]]
check("35계단 오른 책만 '상승'", ups == ["책5"], ups)
check("제자리인 책은 상승에 없음", "책1" not in ups)


print("\n[4] 모르는 모델이면 0원으로 넘어가지 않고 멈추기")
# ⚠️ 요금을 모르면 얼마 썼는지도 모릅니다. 0원으로 세면 한도가 무의미해집니다.
conf_bad = {"pricing": {"claude-opus-5": {"input": 5.0, "output": 25.0}}}
try:
    rr.price_of(conf_bad, "무슨모델-9")
    check("모르는 모델에서 멈춤", False, "안 멈췄습니다")
except SystemExit as e:
    check("모르는 모델에서 멈춤", True)
    check("어느 모델이 문제인지 알려줌", "무슨모델-9" in str(e), str(e))


print("\n[5] 돈 계산이 맞는지")
conf5 = {"pricing": {"claude-opus-5": {"input": 5.0, "output": 25.0}}}
# 100만 토큰 넣고 100만 토큰 나오면 5 + 25 = 30달러
check("100만/100만 = $30", rr.cost_of(conf5, "claude-opus-5", 10**6, 10**6) == 30.0)
# 실제로 예상되는 규모: 넣는 값 8,000 · 나오는 값 1,500
one = rr.cost_of(conf5, "claude-opus-5", 8000, 1500)
check("1건 약 $0.0775", abs(one - 0.0775) < 1e-9, one)
check("한 달(31일) 약 $2.4", abs(one * 31 - 2.4) < 0.05, one * 31)


print("\n[6] 이번 달 쓴 돈을 세는지")
db6 = FakeDB({})
db6.costs = [0.08, 0.07, 0.09]
spent, n = rr.spent_this_month(db6, "2026-08-10")
check("건수 3", n == 3, n)
check("합계 0.24", abs(spent - 0.24) < 1e-9, spent)

db6.costs = [None, 0.05]        # 옛 자료에 비용이 안 적혀 있을 수 있습니다
spent, n = rr.spent_this_month(db6, "2026-08-10")
check("비어 있는 값이 있어도 안 터짐", abs(spent - 0.05) < 1e-9, spent)


print("\n[7] config/report.yaml 이 실제로 쓸 수 있는 상태인지")
conf = cfg.load("report.yaml")
model = conf.get("model")
check("model 이 pricing 에 있음", model in (conf.get("pricing") or {}), model)
cap = conf.get("monthly_cap_usd")
check("한도가 숫자", isinstance(cap, (int, float)), cap)
check("한도가 월 5,000원 예산 안", cap * rr.KRW_PER_USD <= 5000, cap * rr.KRW_PER_USD)
check("effort 가 low/medium/high", conf.get("effort") in ("low", "medium", "high"),
      conf.get("effort"))
# effort 가 xhigh/max 면 생각을 끌 수 없습니다 (API 가 400 으로 거절).
check("생각을 끄는 설정과 effort 가 안 부딪힘",
      conf.get("thinking") is False and conf.get("effort") in ("low", "medium", "high"))
for name, row in (conf.get("pricing") or {}).items():
    check(f"'{name}' 요금에 input/output 이 다 있음",
          "input" in row and "output" in row, row)

# 실제 요금표와 어긋나면 비용 계산이 조용히 틀립니다 (2026-06-24 기준)
KNOWN = {
    "claude-opus-5": (5.0, 25.0),
    "claude-sonnet-5": (3.0, 15.0),
    "claude-haiku-4-5": (1.0, 5.0),
}
for name, (i, o) in KNOWN.items():
    row = (conf.get("pricing") or {}).get(name)
    if row:
        check(f"'{name}' 요금이 공개 요금과 같음",
              (float(row["input"]), float(row["output"])) == (i, o), row)


print("\n[8] 깔린 라이브러리가 우리가 보내는 값을 받아주는지")
# 🚨 이 시험이 없어서 실제로 터졌습니다 (2026-08-09).
#    requirements.txt 에 anthropic==0.71.0 을 고정해 두고 코드는
#    output_config 를 썼는데, 그 버전에는 그런 값이 없었습니다.
#    시험 30가지가 전부 통과했는데도 운영에서 죽었습니다 —
#    시험이 '제가 만든 계산' 만 보고 '라이브러리' 는 안 봤기 때문입니다.
kw = rr.build_kwargs(conf, "시험용 글")
check("보낼 값에 model/max_tokens/messages 가 있음",
      {"model", "max_tokens", "messages"} <= set(kw), sorted(kw))
check("effort 가 설정대로 들어감",
      kw.get("output_config", {}).get("effort") == conf.get("effort"), kw.get("output_config"))
check("생각 끄기가 들어감",
      kw.get("thinking") == {"type": "disabled"}, kw.get("thinking"))

if HAVE_SDK:
    import anthropic

    missing = rr.check_sdk(kw)
    check(
        f"anthropic {anthropic.__version__} 이(가) 전부 받아줌",
        missing == [],
        f"못 받는 값: {missing} — crawler/requirements.txt 의 버전을 올려야 합니다",
    )
else:
    # 여기서 조용히 넘어가면 예전과 똑같은 구멍이 생깁니다. 크게 알립니다.
    print("  ⚠️ anthropic 라이브러리가 안 깔려 있어 이 확인은 건너뜁니다.")
    print("     (CI 에서는 반드시 깔린 상태로 돌아갑니다 —"
          " .github/workflows/report.yml)")


print("\n[9] 부탁하는 말에 '지어내지 말라' 가 들어 있는지")
check("지어내지 말라", "지어내지 마세요" in rr.SYSTEM)
check("모르면 모른다고", "알 수 없습니다" in rr.SYSTEM)
check("어제 자료 없을 때 규칙", "어제 자료가 없습니다" in rr.SYSTEM)


print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    for f in failures:
        print(f"   · {f}")
    raise SystemExit(1)
print("✅ 모두 통과")
