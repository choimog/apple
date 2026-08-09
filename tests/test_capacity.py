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

from capacity import FREE_LIMIT_MB, MIN_KEEP_DAYS, project  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


MB = 1_000_000


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
check("순위 자료만 센다 (rankings 32 + book_meta 12) ÷ 2일 = 22MB",
      abs(p["per_day"] - 22) < 0.01, p["per_day"])
check("도서 목록은 따로 센다 (192 - 44 = 148MB)",
      abs(p["catalog"] - 148) < 0.01, p["catalog"])
check("'3일 뒤 꽉 참' 이라고 하지 않는다", p["days_left"] > 10, p["days_left"])

print("\n[2] 도달할 최대치를 본다 — 이게 진짜 봐야 할 숫자")
# 148 + 22×14 = 456MB. 한도 안이지만 여유가 44MB 뿐입니다.
check("예상 최대 = 목록 + 하루치×보관일수",
      abs(p["steady"] - 456) < 0.01, p["steady"])
check("한도 안이면 문제 없음으로 본다", p["problem"] is None, p["problem"])

print("\n[3] 구조적으로 안 맞으면 먼저 알린다")
# 보관 일수를 늘리면 넘칩니다. '며칠 남았다' 만 봐서는 이걸 못 봅니다.
long_keep = project(real, 2, 30)
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
