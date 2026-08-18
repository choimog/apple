"""
용량 예측이 거짓말을 하지 않는지 시험.

【왜 필요한가요? — 2026-08-09】
이 계산이 실제로 틀렸습니다. 2일치만 모인 상태에서
"하루 95.9MB · 3일 뒤 꽉 참" 이라고 알려서 자동 검사가 매번 빨간불이
됐습니다. 검사가 늘 빨간불이면 진짜 고장도 같이 묻힙니다.

그래서 그때의 실제 숫자를 그대로 넣어 두고, 다시는 그 답이 나오지
않는지 확인합니다.

실행: python tests/test_capacity.py
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

# 시험은 데이터베이스 없이 돌아야 합니다 (계산만 봅니다)
_fake = types.ModuleType("supabase")
_fake.Client = object
_fake.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _fake)

from capacity import (  # noqa: E402
    FREE_LIMIT_MB, HORIZON_DAYS, MIN_KEEP_DAYS, NEVER_PRUNED,
    SLOW_GROW_TABLES, describe, project,
)

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


MB = 1_000_000

# 설정 파일과 화면 코드를 그대로 읽어 둡니다 (베끼면 한쪽만 고쳐집니다)
import yaml  # noqa: E402

cfg_yaml = yaml.safe_load((ROOT / "config" / "archive.yaml").read_text(encoding="utf-8"))
ts_src = (ROOT / "web" / "lib" / "report.ts").read_text(encoding="utf-8")


def t(name: str, total_mb: float) -> dict:
    return {"table_name": name, "total_bytes": total_mb * MB}


print("=" * 66)
print("  용량 예측")
print("=" * 66)

print("\n[1] 2026-08-09 에 실제로 나온 숫자")
# 그때 검사 로그: 192MB / 500MB · 2일치 · 하루 약 95.9MB · 남은 여유 약 3일
#                store_books 55MB · books 53MB · rankings 32MB
#
# ⚠️ 로그에는 큰 표 3개만 찍혔습니다. 나머지는 합이 192MB 가 되도록
#    제가 채운 값입니다. 전체 합과 상위 3개는 실제 값입니다.
real = [
    t("store_books", 55), t("books", 53), t("rankings", 32),
    t("book_matches", 30), t("book_meta", 12), t("crawl_logs", 10),
]
p = project(real, 2, 14)

check("전체는 그대로 192MB", round(p["total"]) == 192, p["total"])
check("하루 증가량이 95.9MB 가 아니다 (그게 거짓말이었습니다)",
      p["per_day"] < 40, p["per_day"])
# 【2026-08-10】 book_meta 가 '날마다 쌓이는 것' 에서 빠졌습니다.
# 이제 책마다 한 줄이라 날마다 늘지 않습니다 (db/meta-slim.sql).
# 그래서 하루 증가량은 rankings 만, book_meta 는 도서 목록 쪽으로 갑니다.
check("순위 자료만 센다 (rankings 32) ÷ 2일 = 16MB",
      abs(p["per_day"] - 16) < 0.01, p["per_day"])
check("book_meta 는 이제 하루 증가량에 안 들어간다",
      abs(p["per_day"] - 16) < 0.01, p["per_day"])
check("도서 목록에 book_meta 가 들어간다 (192 - 32 - 10 = 150MB)",
      abs(p["catalog"] - 150) < 0.01, p["catalog"])
check("기록·리포트를 따로 센다 (crawl_logs 10MB)",
      abs(p["slow"] - 10) < 0.01, p["slow"])
check("'3일 뒤 꽉 참' 이라고 하지 않는다", p["days_left"] > 10, p["days_left"])

print("\n[2] 도달할 최대치를 본다 — 이게 진짜 봐야 할 숫자")
# 150(목록) + 16×14(순위) + 5×180(기록) = 1,274MB → 한도를 넘습니다.
# 기록이 하루 5MB 씩 늘면 180일 보관으로는 감당이 안 된다는 뜻입니다.
check("예상 최대에 기록 보관분이 들어간다",
      abs(p["steady"] - (150 + 16 * 14 + 5 * 180)) < 0.01, p["steady"])

print("\n[2-1] 🚨 늘어나는 것을 '안 늘어난다' 고 세지 않는다")
# 【2026-08-09 대표님 질문에서 찾은 잘못】
# crawl_logs·daily_reports 는 날마다 늘어나는데 보관소로 안 빠집니다.
# 그런데 '도서 목록(거의 안 늘어남)' 쪽에 들어가 있었습니다.
# 그러면 예상 최대치가 계속 실제보다 낮게 나옵니다.
# 낮게 나오는 경고는 안 나오는 경고와 같습니다.
old_way = 150 + 10 + 16 * 14          # 예전 계산 (기록을 고정으로 봄)
check("예전 계산보다 크게 잡는다", p["steady"] > old_way, (p["steady"], old_way))
check("기록도 하루 증가량으로 센다",
      abs(p["slow_per_day"] - 5) < 0.01, p["slow_per_day"])
# 하루 16MB(순위) + 5MB(기록) = 21MB
check("'며칠 남았나' 에도 기록 증가분을 넣는다",
      p["days_left"] == int((500 - 192) / 21), p["days_left"])

print("\n[3] 구조적으로 안 맞으면 먼저 알린다")
# 보관 일수를 늘리면 넘칩니다. '며칠 남았다' 만 봐서는 이걸 못 봅니다.
# ⚠️ catalog_per_day=0 을 일부러 넣습니다. 안 넣으면 '못 쟀다' 가 먼저
#    걸려서, 여기서 보고 싶은 '보관 일수' 문제가 가려집니다.
long_keep = project(real, 2, 30, catalog_per_day=0.0)
check("보관 30일이면 넘친다고 알린다", long_keep["problem"] is not None)
check("보관 일수를 줄이라고 말한다",
      "보관 일수" in (long_keep["problem"] or ""), long_keep["problem"])

print("\n[4] 보관 일수는 14일 밑으로 못 내려간다")
# archive.py 에 최소값이 박혀 있습니다. 여기서 7일로 계산하면
# 실제보다 낙관적인 답이 나옵니다.
short = project(real, 2, 7)
check(f"7일을 넣어도 {MIN_KEEP_DAYS}일로 계산한다",
      short["keep"] == MIN_KEEP_DAYS, short["keep"])

print("\n[5] 진짜 위험할 때는 반드시 알린다")
huge = [t("rankings", 300), t("books", 160)]
check("이미 90% 를 넘겼으면 알린다", project(huge, 2, 14)["problem"] is not None)

soon = [t("rankings", 40), t("books", 420)]   # 하루 20MB, 남은 40MB → 2일
check("곧 닿으면 알린다", project(soon, 2, 14)["problem"] is not None)

print("\n[6] archive.py 와 어긋나지 않는다")
# 두 파일이 다른 표를 '날마다 쌓이는 것' 으로 보면 계산이 조용히 틀립니다.
import archive  # noqa: E402
from capacity import PER_DAY_TABLES  # noqa: E402

check("보관 대상 표 목록이 같다",
      PER_DAY_TABLES == set(archive.TABLES), (PER_DAY_TABLES, set(archive.TABLES)))
check("최소 보관 일수가 같다",
      MIN_KEEP_DAYS == archive.ABSOLUTE_MIN_KEEP_DAYS, MIN_KEEP_DAYS)
# 보관소로 빠지는 표와 '안 빠지는데 늘어나는 표' 가 겹치면 두 번 셉니다
check("두 분류가 겹치지 않는다",
      not (PER_DAY_TABLES & SLOW_GROW_TABLES), PER_DAY_TABLES & SLOW_GROW_TABLES)
# 🚨 두 파일이 서로 다른 표를 지우면 계산이 조용히 틀립니다.
#    (capacity 는 '지워진다' 고 세는데 archive 는 안 지우는 경우)
check("정리하는 표 목록이 archive.py 와 같다",
      SLOW_GROW_TABLES == set(archive.PRUNE_TABLES),
      (SLOW_GROW_TABLES, set(archive.PRUNE_TABLES)))
check("리포트도 정리 대상 (2026-08-09 대표님 승인)",
      "daily_reports" in archive.PRUNE_TABLES)
check("안 지우는 표는 지금 없다", NEVER_PRUNED == set(), NEVER_PRUNED)

print("\n[6-1] 나중에 '안 지우는 표' 가 생겨도 1년 뒤로 본다")
# 지금은 비어 있지만, 개념을 지우면 안 됩니다. 안 지우는 표를 여기
# 안 넣는 순간 용량 계산이 다시 조용히 틀립니다.
check("1년은 365일", HORIZON_DAYS == 365, HORIZON_DAYS)
never = [t("books", 100), t("rankings", 10)]
r1 = project(never, 10, 14)
check("안 지우는 표가 없으면 그만큼만 센다",
      abs(r1["steady"] - (100 + 1 * 14)) < 0.01, r1["steady"])

print("\n[6-2] 기록 보관 일수를 줄이면 예상치가 줄어든다")
short_logs = project(real, 2, 14, log_keep=30)
check("180일 → 30일 로 줄이면 예상 최대가 준다",
      short_logs["steady"] < p["steady"], (short_logs["steady"], p["steady"]))
check("얼마나 남기는지 알려준다", short_logs["log_keep"] == 30, short_logs["log_keep"])

print("\n[6-3] 설정과 화면이 같은 숫자를 말하는지")
# 화면에 "최근 180일치만 남깁니다" 라고 적어 두고 실제로는 30일에 지우면
# 화면이 거짓말을 합니다. 두 숫자가 어긋나면 여기서 잡습니다.
import re  # noqa: E402

acfg_days = int(
    cfg_yaml.get("log_keep_days", 0)
)
m = re.search(r"REPORT_KEEP_DAYS\s*=\s*(\d+)", ts_src)
check("web/lib/report.ts 에 REPORT_KEEP_DAYS 가 있다", m is not None)
if m:
    check(f"설정({acfg_days}일) 과 화면({m.group(1)}일) 이 같다",
          int(m.group(1)) == acfg_days, (acfg_days, m.group(1)))


print("\n[8] 🚨 2026-08-18 — 도서 목록을 '안 늘어난다' 고 세지 않는다")
# 【대표님 질문에서 찾은 잘못】
#   "7일 정도 수집됐어. 용량이 얼마나 버틸 수 있을것 같아?"
#
# db/space-growth.sql 로 재 보니 도서 목록이 하루 12MB 씩 늘고 있었는데,
# 이 계산은 그것을 '거의 안 늘어남' 으로 보고 있었습니다. 전체 증가량의
# 58% 를 0 으로 센 것입니다. 그러면 경고가 영영 안 뜹니다.
#
# 그때의 실제 표 크기를 그대로 넣어 둡니다.
real_0818 = [
    t("rankings", 60), t("books", 59), t("store_books", 48),
    t("book_matches", 29), t("crawl_logs", 1.12),
]
CAT_PER_DAY = 12.2      # 실측: store_books 4.4 + books 5.3 + matches 2.5

none_p = project(real_0818, 7, 14)
check("🚨 못 쟀으면 '못 쟀다' 고 말한다 (0 으로 세지 않는다)",
      none_p["catalog_measured"] is False and none_p["problem"] is not None,
      none_p["problem"])
check("못 쟀다는 것이 문제 문구에 드러난다",
      "재지 못했" in (none_p["problem"] or ""), none_p["problem"])

now = project(real_0818, 7, 14, catalog_per_day=CAT_PER_DAY)
check("도서 목록 증가분이 '며칠 남았나' 에 들어간다",
      now["days_left"] < none_p["days_left"], (now["days_left"], none_p["days_left"]))
# 순위 60/7=8.57 + 기록 1.12/7=0.16 + 목록 12.2 = 20.9MB/일
# 남은 여유 (500-197.1)=302.9 → 14일
check("하루 약 21MB · 약 14일 남았다고 본다",
      13 <= now["days_left"] <= 15, now["days_left"])
check("🚨 정리 장치가 없다는 것을 먼저 알린다",
      "정리하는 장치가 없" in (now["problem"] or ""), now["problem"])
check("보관 일수를 줄이라는 엉뚱한 말을 하지 않는다",
      "보관 일수" not in (now["problem"] or ""), now["problem"])

print("\n[8-1] 정리 장치를 붙이면 예상치가 실제로 내려간다")
fixed = project(real_0818, 7, 14, catalog_per_day=CAT_PER_DAY,
                catalog_keep_days=14)
check("1년 뒤 예상이 크게 준다", fixed["steady"] < now["steady"] / 3,
      (fixed["steady"], now["steady"]))
check("한도 안에 들어온다", fixed["steady"] < FREE_LIMIT_MB, fixed["steady"])
check("몇 일치로 정리하는지 알려준다", fixed["catalog_keep"] == 14)
# 목록 136(지금) + 12.2×(14-7 남은 날) = 221
#  + 순위 8.57×14 = 120 + 기록 0.16×180 = 29  →  370MB
check("예상 최대 약 370MB", abs(fixed["steady"] - 370) < 5, fixed["steady"])

print("\n[8-1-1] 🚨 설정만 믿고 '괜찮다' 고 하지 않는다")
# 【2026-08-18 — 오늘 세 번째로 되풀이할 뻔한 잘못】
# 처음에는 cat_per_day × catalog_keep_days 로 셌습니다. 그러면 설정에
# '14일' 이라고 적혀 있기만 하면 예상치가 171MB 로 고정됩니다.
# [도서 목록 정리] 가 조용히 멈춰서 실제로는 계속 쌓이고 있어도
# 경고가 영영 안 뜹니다.
#
# 아래는 '정리가 몇 달째 안 돌아서 도서 목록이 700MB 가 된' 상황입니다.
# 설정에는 여전히 14일이라고 적혀 있습니다.
broken = [
    t("rankings", 120), t("books", 300), t("store_books", 250),
    t("book_matches", 150), t("crawl_logs", 20),
]
bad = project(broken, 60, 14, catalog_per_day=CAT_PER_DAY,
              catalog_keep_days=14)
check("🚨 설정이 14일이어도 실제 크기를 보고 알린다",
      bad["problem"] is not None, bad["problem"])
check("예상치가 실제 크기보다 작지 않다",
      bad["steady"] >= bad["catalog"], (bad["steady"], bad["catalog"]))
# 예전 계산이었다면 12.2×14 = 171MB 로 나와서 "여유 있다" 고 했을 것입니다
check("🚨 예전 방식(171MB)처럼 낙관하지 않는다",
      bad["steady"] > 400, bad["steady"])
check("🚨 '정리가 안 돌고 있다' 고 짚어 준다",
      bad["stale_prune"] is True and "도서 목록 정리" in (bad["problem"] or ""),
      bad["problem"])
check("보관 일수를 줄이라는 엉뚱한 말을 하지 않는다",
      "보관 일수" not in (bad["problem"] or ""), bad["problem"])
check("정상일 때는 그런 말을 안 한다", fixed["stale_prune"] is False)

print("\n[8-1-3] 🚨 잘 돌고 있으면 '며칠 뒤 한도' 라고 겁주지 않는다")
# 정리가 한 바퀴 돌아 멈춰 있는데도 하루 증가량으로 끝까지 나누면
# "8일 뒤 한도" 가 나옵니다. 매일 뜨는 거짓 경고는 진짜 고장을 묻습니다.
steady_now = [
    t("rankings", 120), t("books", 85), t("store_books", 70),
    t("book_matches", 42), t("crawl_logs", 3),
]
calm = project(steady_now, 15, 14, catalog_per_day=CAT_PER_DAY,
               catalog_keep_days=14)
check("도달점이 한도 안이다", calm["steady"] < FREE_LIMIT_MB, calm["steady"])
check("🚨 '한도에 닿지 않는다' 로 본다 (999)",
      calm["days_left"] >= 999, calm["days_left"])
check("경고를 띄우지 않는다", calm["problem"] is None, calm["problem"])
check("화면에도 닿지 않는다고 적는다",
      "닿지 않습니다" in describe(calm, "rankings 120MB"))
# 반대로 진짜 넘칠 때는 날짜를 셉니다
check("넘칠 때는 며칠 남았는지 센다", bad["days_left"] < 999, bad["days_left"])

print("\n[8-1-2] 아직 한 바퀴 안 돌았으면 남은 날만큼만 더 본다")
# 모은 지 3일이면 정리가 아직 한 번도 안 돌았습니다.
# 앞으로 11일치가 더 쌓입니다.
early = project(real_0818, 3, 14, catalog_per_day=CAT_PER_DAY,
                catalog_keep_days=14)
late = project(real_0818, 20, 14, catalog_per_day=CAT_PER_DAY,
               catalog_keep_days=14)
check("3일째가 20일째보다 예상치가 크다 (아직 더 쌓일 것이 남음)",
      early["steady"] > late["steady"], (early["steady"], late["steady"]))
check("한 바퀴 돈 뒤에는 지금 크기가 곧 도달점",
      abs(late["steady"] - (late["catalog"] + late["per_day"] * 14
                            + late["slow_per_day"] * 180)) < 0.01,
      late["steady"])

print("\n[8-2] 첫 수집일을 증가 속도로 세지 않는다 (2026-08-09 의 그 잘못)")
from capacity import CATALOG_SAMPLE_DAYS, measure_catalog_growth  # noqa: E402


class _FakeTable:
    """first_seen_at 이 cutoff 이후인 줄만 세는 흉내."""

    def __init__(self, per_day: dict[str, int]):
        self.per_day = per_day
        self.lo, self.hi = "", "9999"

    def select(self, *a, **k):
        return self

    def gte(self, _col, value):
        self.lo = value
        return self

    def lt(self, _col, value):
        self.hi = value
        return self

    def execute(self):
        n = sum(v for d, v in self.per_day.items() if self.lo <= d < self.hi)
        return types.SimpleNamespace(count=n)


class _FakeClient:
    def __init__(self, per_day):
        self._t = _FakeTable(per_day)

    def table(self, _name):
        return self._t


import datetime as _dt  # noqa: E402

# 첫날 36,058 · 그 뒤 6,738 (대표님이 보내주신 실제 값)
_today = _dt.date.today()
per_day = {(_today - _dt.timedelta(days=6)).isoformat(): 36058}
for i in range(6):
    per_day[(_today - _dt.timedelta(days=i)).isoformat()] = 6738

rows_with_count = [
    dict(t("store_books", 48), row_count=76485),
    t("books", 59), t("book_matches", 29), t("rankings", 60),
]
got = measure_catalog_growth(_FakeClient(per_day), rows_with_count, n_days=7)
check("첫날(36,058줄)이 창 밖으로 빠진다",
      got is not None and got < 20, got)
# 6,738줄/일 × (136MB ÷ 76,485줄) = 약 12.0MB/일
check("실측과 맞는다 (약 12MB/일)", got is not None and abs(got - 12.0) < 1.0, got)
# 첫날까지 세면 (36,058+6,738×6)/7 = 11,001줄/일 → 약 19.6MB/일 (63% 부풀림)
check("🚨 첫날까지 세는 값(약 19.6MB)이 아니다",
      got is not None and got < 15, got)

# 🚨 오늘치가 아직 안 들어왔거나 반만 들어와도 값이 흔들리면 안 됩니다.
#    (수집이 실패한 날 검사가 돌면 '갑자기 여유가 생겼다' 고 착각합니다)
half = dict(per_day)
half[_today.isoformat()] = 0          # 오늘 수집이 아직 안 됨
check("오늘 수집이 안 됐어도 같은 값이 나온다",
      abs((measure_catalog_growth(_FakeClient(half), rows_with_count, 7) or 0)
          - (got or 0)) < 0.01)

print("\n[8-3] 못 잴 때는 지어내지 않는다")
check("첫날 하루뿐이면 None", measure_catalog_growth(_FakeClient(per_day),
                                                 rows_with_count, 1) is None)
check("줄 수를 모르면 None",
      measure_catalog_growth(_FakeClient(per_day),
                             [t("store_books", 48)], 7) is None)
check("DB 가 답을 못 주면 None (죽지 않는다)",
      measure_catalog_growth(object(), rows_with_count, 7) is None)
check("창은 첫 수집일을 넘지 않는다 (3일 기본)", CATALOG_SAMPLE_DAYS == 3)

print("\n[8-4] capacity 와 archive 가 같은 표를 본다")
from capacity import CATALOG_TABLES  # noqa: E402

check("도서 목록과 순위 자료가 겹치지 않는다",
      not (CATALOG_TABLES & PER_DAY_TABLES), CATALOG_TABLES & PER_DAY_TABLES)
check("도서 목록과 기록·리포트가 겹치지 않는다",
      not (CATALOG_TABLES & SLOW_GROW_TABLES), CATALOG_TABLES & SLOW_GROW_TABLES)
# 🚨 archive.py 가 도서 목록을 안 지운다는 것이 이 계산의 전제입니다.
#    나중에 지우게 되면 catalog_keep_days 를 넣어야 합니다.
check("archive.py 는 도서 목록을 정리하지 않는다 (그래서 계속 쌓임)",
      not (CATALOG_TABLES & set(archive.PRUNE_TABLES)),
      set(archive.PRUNE_TABLES))

print("\n[7] 이상한 값이 들어와도 안 터진다")
check("빈 목록", project([], 0, 14)["total"] == 0)
check("날짜 0일을 1일로 본다", project(real, 0, 14)["per_day"] > 0)
check("한도 그 자체",
      project([t("rankings", FREE_LIMIT_MB)], 1, 14)["problem"] is not None)

print("\n" + "=" * 66)
if failures:
    print(f"  ❌ 실패 {len(failures)}건: {', '.join(failures)}")
    raise SystemExit(1)
print("  ✅ 전부 통과")
raise SystemExit(0)
