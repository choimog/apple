"""
🚨 보관 파일을 대표님이 **열어서 읽을 수 있는지** 시험.

【2026-08-28 대표님 요청】
  "받은 파일을 활용할 수 있는 방법은 전혀 없는 건가? 대책을 마련해 볼 수
   있겠어?"

보관 파일(.jsonl.gz)에 들어가는 것은 다섯 가지뿐입니다.
    날짜 · 분야번호 · 순위 · 상품번호 · 판매지수
제목도 저자도 없습니다. 메모장으로 열면 숫자만 보입니다.

🚨 그리고 시간이 지나면 **영영 못 읽습니다.** 제목은 store_books 표에
   있는데, 그 날짜 순위가 보관소로 빠지고 나면 [도서 목록 정리]가 그
   상품 줄을 지웁니다(잠들었으므로). 그러면 '상품번호 52831' 이 무엇이었는지
   알 방법이 사라집니다. 데이터베이스를 뒤져도 없습니다.

그래서 **보관하는 그 순간에** 제목을 함께 적어 둡니다. 그때가 마지막
기회입니다. 이 시험이 그것을 못 박습니다.

실행: python tests/test_archive_readable.py
※ 인터넷도 데이터베이스도 필요 없습니다 (가짜 응답으로 시험합니다).
"""

from __future__ import annotations

import csv
import io
import sys
import types
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

_fake = types.ModuleType("supabase")
_fake.Client = object
_fake.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _fake)

import archive  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


# ---------------------------------------------------------------------------
#  가짜 데이터베이스 — 우리가 묻는 것에만 답합니다
# ---------------------------------------------------------------------------
CATEGORIES = [
    {"id": 10, "name": "소설", "kind": "online", "branch_name": "", "store_id": 1},
    {"id": 20, "name": "전체", "kind": "weekly", "branch_name": "", "store_id": 2},
    {"id": 30, "name": "전체", "kind": "offline", "branch_name": "광화문점", "store_id": 1},
]
STORE_BOOKS = [
    {"id": 100, "raw_title": "세이노의 가르침", "raw_author": "세이노",
     "raw_publisher": "데이원", "pub_ym": "2026-03", "list_price": 7200,
     "isbn13": "9791193000000"},
    # 🚨 값이 비어 있는 책 — 지어내지 않고 빈 칸으로 둬야 합니다
    {"id": 200, "raw_title": "쉼표, 반점", "raw_author": None,
     "raw_publisher": None, "pub_ym": None, "list_price": None, "isbn13": None},
    # 제목에 쉼표·따옴표가 든 책 (엑셀에서 칸이 밀리면 안 됩니다)
    {"id": 300, "raw_title": '아무튼, "책"', "raw_author": "김작가",
     "raw_publisher": "위고", "pub_ym": "2026-01", "list_price": 13000,
     "isbn13": None},
]
STORES = [{"id": 1, "name": "교보문고"}, {"id": 2, "name": "예스24"}]


class FakeQuery:
    def __init__(self, rows):
        self._rows = rows
        self._ids = None

    def select(self, *a, **k):
        return self

    def in_(self, _col, ids):
        self._ids = set(ids)
        return self

    def execute(self):
        rows = self._rows
        if self._ids is not None:
            rows = [r for r in rows if r["id"] in self._ids]
        return types.SimpleNamespace(data=rows)


class FakeDB:
    TABLES = {"categories": CATEGORIES, "store_books": STORE_BOOKS, "stores": STORES}

    def table(self, name):
        return FakeQuery(self.TABLES[name])


ROWS = [
    {"snapshot_date": "2026-08-12", "category_id": 10, "rank": 2,
     "store_book_id": 100, "sales_point": 184000},
    {"snapshot_date": "2026-08-12", "category_id": 10, "rank": 1,
     "store_book_id": 300, "sales_point": None},      # 교보는 판매지수를 안 줍니다
    {"snapshot_date": "2026-08-12", "category_id": 20, "rank": 5,
     "store_book_id": 200, "sales_point": 900},
    {"snapshot_date": "2026-08-12", "category_id": 30, "rank": 3,
     "store_book_id": 100, "sales_point": None},
]

text = archive.readable_csv(FakeDB(), date(2026, 8, 12), ROWS)


# ---------------------------------------------------------------------------
print("\n[1] 🚨 엑셀에서 한글이 안 깨지는가")
check("맨 앞에 BOM 이 있다", text.startswith("﻿"),
      "이게 없으면 엑셀에서 한글이 전부 깨집니다")

parsed = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
head, body = parsed[0], parsed[1:]


print("\n[2] 사람이 읽을 수 있는 칸이 들어 있는가")
for col in ("날짜", "서점", "분야", "순위", "제목", "저자", "출판사", "판매지수"):
    check(f"'{col}' 칸이 있다", col in head, head)
check("줄 수가 맞다", len(body) == len(ROWS), len(body))


print("\n[3] 🚨 제목이 실제로 들어 있는가 (이게 이 파일의 존재 이유)")
titles = {r[head.index("제목")] for r in body}
check("제목이 채워졌다", "세이노의 가르침" in titles, titles)
check("서점 이름이 번호가 아니라 이름이다",
      "교보문고" in {r[head.index("서점")] for r in body})
check("분야도 이름이다", "소설" in {r[head.index("분야")] for r in body})
check("매장 이름도 함께 적힌다",
      any("광화문점" in r[head.index("분야")] for r in body))
check("일간·주간이 사람 말로 적힌다",
      {"일간", "주간", "매장"} >= {r[head.index("기간")] for r in body},
      {r[head.index("기간")] for r in body})


print("\n[4] 🚨 값이 없으면 빈 칸으로 둔다 (지어내지 않는다)")
row200 = [r for r in body if r[head.index("제목")] == "쉼표, 반점"][0]
for col in ("저자", "출판사", "출간월", "정가", "ISBN"):
    check(f"모르는 '{col}' 은 빈 칸", row200[head.index(col)] == "",
          row200[head.index(col)])
# 교보는 판매지수를 아예 제공하지 않습니다. 0 이 아니라 빈 칸이어야 합니다.
kyobo = [r for r in body if r[head.index("제목")] == '아무튼, "책"'][0]
check("🚨 판매지수 없음을 0 이 아니라 빈 칸으로 둔다",
      kyobo[head.index("판매지수")] == "", kyobo[head.index("판매지수")])


print("\n[5] 제목에 쉼표·따옴표가 있어도 칸이 안 밀린다")
check("쉼표가 든 제목이 한 칸에 들어간다",
      any(r[head.index("제목")] == "쉼표, 반점" for r in body))
check("따옴표가 든 제목도 그대로 읽힌다",
      any(r[head.index("제목")] == '아무튼, "책"' for r in body))
check("모든 줄의 칸 수가 같다",
      all(len(r) == len(head) for r in body),
      [len(r) for r in body])


print("\n[6] 🚨 되돌리기용 원본은 그대로인가")
"""
엑셀 파일은 '있으면 좋은 것' 이고, .jsonl.gz 가 진짜입니다.
원본에 칸이 하나라도 늘면 [보관소에서 불러오기] 가 깨집니다.
"""
check("보관하는 칸이 그대로다 (다섯 가지)",
      archive.TABLES["rankings"]
      == "snapshot_date,category_id,rank,store_book_id,sales_point",
      archive.TABLES["rankings"])

src = (ROOT / "crawler" / "archive.py").read_text(encoding="utf-8")
check("엑셀 만들기가 실패해도 보관은 계속한다",
      "엑셀용 파일 만들기 실패(보관은 계속)" in src,
      "여기서 넘어지면 그날 보관이 통째로 멈춥니다")
check("엑셀 파일은 따로 넣는다 (excel/ 폴더)", '"excel"' in src)
check("무엇이 무엇인지 적은 안내문을 같이 넣는다", "README.txt" in src)


print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    raise SystemExit(1)
print("✅ 모두 통과")
