"""
보관·백업 파일이 넣은 그대로 되돌아오는지 시험.

【왜 이 시험이 필요한가요? — 2026-08-08】
무료 요금제로 가기로 하면서, 오래된 자료는 보관소 파일로만 남습니다.
그 파일이 잘못 만들어지면 **되돌릴 방법이 없습니다.**
'담기 → 풀기' 가 정확히 원래대로 돌아오는지 여기서 못박아 둡니다.

특히 확인하는 것
  · 한글이 깨지지 않는가
  · 값이 없는 칸(None)이 0 이나 빈 글자로 바뀌지 않는가
  · 같은 내용이면 항상 같은 지문이 나오는가 (안 그러면 확인 자체가 무의미)

실행: python tests/test_archive_roundtrip.py
※ 인터넷도 DB 도 필요 없습니다.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

failures: list[str] = []


def check(name: str, got, want) -> None:
    if got == want:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}\n       나온 값: {got!r}\n       기대 값: {want!r}")
        failures.append(name)


# archive.py 는 supabase 를 불러오므로, DB 없이 시험하려고 가짜로 채웁니다
import types  # noqa: E402
fake = types.ModuleType("supabase")
fake.Client = object
fake.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", fake)

from archive import pack  # noqa: E402
from restore import rows_of  # noqa: E402

print("=" * 60)
print("  보관 파일 담기·풀기")
print("=" * 60)

# 실제 순위 한 줄과 같은 모양. 판매지수가 없는 교보 줄도 섞습니다.
rows = [
    {"snapshot_date": "2026-08-08", "category_id": 1, "rank": 1,
     "store_book_id": 5001, "sales_point": 412300},
    {"snapshot_date": "2026-08-08", "category_id": 1, "rank": 2,
     "store_book_id": 5002, "sales_point": None},
    {"snapshot_date": "2026-08-08", "category_id": 2, "rank": 1,
     "store_book_id": 5003, "sales_point": 0},
]

print("\n[1] 담았다 풀면 원래대로 돌아오는가")
data, digest = pack(rows)
back = rows_of(data)
check("줄 수가 같다", len(back), len(rows))
check("내용이 완전히 같다", back, rows)
check("값 없음(None)이 그대로 유지된다", back[1]["sales_point"], None)
check("숫자 0 이 None 으로 바뀌지 않는다", back[2]["sales_point"], 0)

print("\n[2] 한글이 깨지지 않는가")
ko = [{"raw_title": "싯다르타", "raw_publisher": "민음사",
       "note": "쉼표, 따옴표\" 줄바꿈\n 포함"}]
data2, _ = pack(ko)
check("한글·특수문자가 그대로", rows_of(data2), ko)

print("\n[3] 같은 내용이면 항상 같은 지문인가")
# 지문이 매번 달라지면 '올린 파일이 온전한지' 확인 자체가 무의미해집니다.
# (gzip 은 기본적으로 만든 시각을 파일에 넣으므로 mtime=0 으로 막아 뒀습니다)
_, d1 = pack(rows)
_, d2 = pack(rows)
check("두 번 담아도 지문이 같다", d1, d2)
check("첫 지문과도 같다", d1, digest)

_, d3 = pack(rows[:2])
check("내용이 다르면 지문도 다르다", d3 != d1, True)

print("\n[4] 빈 목록도 처리되는가")
empty, de = pack([])
check("빈 목록을 담아도 터지지 않는다", rows_of(empty), [])
check("빈 목록도 지문이 나온다", len(de), 64)

print("\n" + "=" * 60)
if failures:
    print(f"  ❌ 실패 {len(failures)}건: {', '.join(failures)}")
    raise SystemExit(1)
print("  ✅ 전부 통과")
raise SystemExit(0)
