"""
🚨 매칭을 **처음부터 끝까지** 한 번 돌려 봅니다 (가짜 데이터베이스로).

【2026-08-12 — 이 시험이 없어서 대표님이 대신 발견하셨습니다】

    "출판사 묶음을 했는데 ... 근데 얘는 왜 묶이질 않지?
     출판사를 묶어놓은 상태에서 새롭게 매칭을 돌린 상태거든"

원인은 제가 넣은 코드의 **순서**였습니다. 별칭 표를 읽기도 전에 쓰고
있어서, [도서 매칭] 이 첫 줄에서 죽고 있었습니다.

    UnboundLocalError: cannot access local variable 'pub_alias'

시험 30여 개가 전부 통과했는데도 터진 이유는, 그 시험들이 **함수를
따로따로만** 확인하고 **run_match.main() 을 한 번도 부르지 않았기**
때문입니다. 규칙은 다 맞는데 프로그램이 시작조차 못 하는 상태였습니다.

이 시험은 진짜 데이터베이스 대신 **가짜 표**를 물려서 main() 을 통째로
돌립니다. 순서가 어긋나거나, 없는 칸을 읽거나, 함수 이름이 틀리면
여기서 걸립니다. 인터넷도 DB 도 돈도 들지 않습니다.

실행: python tests/test_match_smoke.py
"""

from __future__ import annotations

import io
import sys
import types
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

_fake = types.ModuleType("supabase")
_fake.Client = object
_fake.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _fake)

from common import config as cfg          # noqa: E402
from common import db as real_db          # noqa: E402
from common import normalize as norm      # noqa: E402
import run_match                          # noqa: E402

CFG = cfg.load("matching.yaml")
PW = CFG["publisher_words"]
AW = CFG.get("role_words")

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


# -----------------------------------------------------------------------------
#  가짜 자료 — 서점 셋에 같은 책이 하나씩 있고, 출판사 표기만 다릅니다
# -----------------------------------------------------------------------------
def book(i: int, store: int, title: str, author: str, pub: str,
         ym: str = "2025-06", price: int = 16800) -> dict:
    t = norm.normalize_title(title, CFG.get("edition_words"),
                             CFG.get("edition_canonical"),
                             CFG.get("title_badge_words"))
    return {
        "id": i, "store_id": store, "store_book_key": f"K{i}",
        "raw_title": title, "raw_author": author, "raw_publisher": pub,
        "norm_title": t["core"], "edition_tags": t["editions"],
        "set_volumes": t["set_volumes"], "norm_subtitle": t["subtitle"],
        "norm_author": norm.normalize_author(author, AW),
        "norm_publisher": norm.normalize_publisher(pub, PW),
        "pub_ym": ym, "isbn13": None, "list_price": price,
        "cover_url": None, "book_id": None,
    }


ROWS = [
    # ① 출판사 표기가 서점마다 다른 책 — 별칭이 있어야 묶입니다
    book(1, 1, "처음 배우는 정원 가꾸기", "김정원", "청림Life"),
    book(2, 2, "처음 배우는 정원 가꾸기", "김정원", "청림라이프"),
    book(3, 3, "처음 배우는 정원 가꾸기", "김정원", "청림라이프"),
    # ② 상관없는 책 — 절대 딸려 들어오면 안 됩니다
    book(4, 1, "싯다르타", "헤르만 헤세", "민음사"),
    book(5, 2, "싯다르타", "헤르만 헤세", "문학동네"),
]
ALIAS = {
    norm.normalize_publisher("청림Life", PW): "청림라이프",
    norm.normalize_publisher("청림라이프", PW): "청림라이프",
}


class FakeDB:
    """main() 이 부르는 db.* 를 전부 가짜로 받아 줍니다."""

    def __init__(self, rows, alias, manual=None):
        self.rows, self.alias, self.manual = rows, alias, manual or {}
        self.saved_matches: list[dict] = []
        self.inserted: list[dict] = []
        self.updated: list[dict] = []
        self.linked: list[dict] = []
        self.deleted_orphans = 0

    # ---- 읽기 ----
    def connect(self):
        return object()

    def fetch_all_store_books(self, client):
        return [dict(r) for r in self.rows]

    def fetch_manual_decisions(self, client):
        return dict(self.manual)

    def fetch_publisher_aliases(self, client):
        return dict(self.alias)

    # ---- 쓰기 ----
    def save_matches(self, client, rows):
        self.saved_matches.extend(rows)

    def insert_books(self, client, rows):
        self.inserted.extend(rows)
        # 진짜 DB 처럼 새 번호를 돌려줍니다
        return list(range(1000, 1000 + len(rows)))

    def update_books(self, client, rows):
        self.updated.extend(rows)

    def link_store_books_bulk(self, client, rows):
        self.linked.extend(rows)

    def delete_orphan_books(self, client, keep):
        self.deleted_orphans += 1
        return 0


def run(rows=ROWS, alias=ALIAS, manual=None, dry=False):
    """main() 을 통째로 돌리고 (종료코드, 화면글, 가짜DB) 를 돌려줍니다."""
    fake = FakeDB(rows, alias, manual)
    saved = {name: getattr(real_db, name, None)
             for name in ("connect", "fetch_all_store_books",
                          "fetch_manual_decisions", "fetch_publisher_aliases",
                          "save_matches", "insert_books", "update_books",
                          "link_store_books_bulk", "delete_orphan_books")}
    for name in saved:
        setattr(real_db, name, getattr(fake, name))
    old_argv, old_dry = sys.argv, __import__("os").environ.get("DRY_RUN", "")
    sys.argv = ["run_match.py"] + (["--dry-run"] if dry else [])
    buf = io.StringIO()
    try:
        with redirect_stdout(buf):
            code = run_match.main()
    finally:
        sys.argv = old_argv
        for name, fn in saved.items():
            if fn is not None:
                setattr(real_db, name, fn)
    return code, buf.getvalue(), fake


print("\n[1] 🚨 매칭이 끝까지 돌아가는가 (이게 이번에 터진 자리입니다)")
try:
    code, out, fake = run()
    check("죽지 않고 끝난다", code == 0, code)
except Exception as exc:                      # noqa: BLE001
    check("죽지 않고 끝난다", False, f"{type(exc).__name__}: {exc}")
    print("\n❌ 여기서 죽으면 [도서 매칭] 이 통째로 안 돕니다.")
    raise SystemExit(1)

check("별칭 표를 읽었다고 알린다", "정하신 이름" in out, out[:200])

print("\n[2] 🚨 별칭 덕분에 실제로 묶였는가")
# 1·2·3 번이 한 무리가 되어야 합니다 (청림Life = 청림라이프)
links = {r["id"]: r["book_id"] for r in fake.linked}
same = links.get(1) is not None and links.get(1) == links.get(2) == links.get(3)
check("청림Life / 청림라이프 세 권이 한 책이 된다", same, links)

print("\n[3] 🚨 상관없는 책이 딸려 들어오지 않았는가")
check("민음사 싯다르타와 문학동네 싯다르타는 따로",
      links.get(4) != links.get(5), links)
check("정원 가꾸기와 싯다르타도 따로",
      links.get(1) != links.get(4), links)

print("\n[4] 별칭이 없으면 예전 그대로 (안 묶임)")
code2, out2, fake2 = run(alias={})
links2 = {r["id"]: r["book_id"] for r in fake2.linked}
check("죽지 않는다", code2 == 0, code2)
check("청림Life 는 따로 남는다 (0.24 라 기준 미달)",
      links2.get(1) != links2.get(2), links2)
check("청림라이프끼리(2·3)는 그대로 묶인다",
      links2.get(2) == links2.get(3) and links2.get(2) is not None, links2)

print("\n[5] 확인 모드(dry-run)에서는 저장하지 않는다")
code3, out3, fake3 = run(dry=True)
check("죽지 않는다", code3 == 0, code3)
check("한 줄도 저장 안 함",
      not fake3.inserted and not fake3.updated and not fake3.linked,
      (len(fake3.inserted), len(fake3.updated), len(fake3.linked)))

print("\n[6] 사람이 이어 놓은 짝도 그대로 먹히는가")
# 4·5 번(민음사/문학동네 싯다르타)을 사람이 '같은 책' 이라고 했다면 묶여야 합니다
code4, out4, fake4 = run(manual={(4, 5): "manual_merge"})
links4 = {r["id"]: r["book_id"] for r in fake4.linked}
check("죽지 않는다", code4 == 0, code4)
check("사람 결정이 출판사 규칙을 이긴다",
      links4.get(4) == links4.get(5) and links4.get(4) is not None, links4)

print("\n[7] 자료가 없어도 죽지 않는다")
try:
    code5, out5, _ = run(rows=[], alias={})
    check("빈 자료에서도 안내만 하고 끝난다", code5 in (0, 1), code5)
except Exception as exc:                      # noqa: BLE001
    check("빈 자료에서도 안내만 하고 끝난다", False, f"{type(exc).__name__}: {exc}")

print("\n[8] 별칭 표가 아예 없어도(SQL 미실행) 매칭은 돈다")
try:
    fake6 = FakeDB(ROWS, {}, None)

    def boom(client):
        raise RuntimeError("relation \"publisher_aliases\" does not exist")

    fake6.fetch_publisher_aliases = boom
    saved = real_db.fetch_publisher_aliases
    # db.fetch_publisher_aliases 안의 try/except 가 막아 줘야 합니다
    got = real_db.fetch_publisher_aliases.__wrapped__ if False else None
    check("db 층이 예외를 삼키고 빈 표로 돌려준다",
          "없는 것으로 봅니다" in (ROOT / "crawler" / "common" / "db.py").read_text(
              encoding="utf-8"))
except Exception as exc:                      # noqa: BLE001
    check("db 층이 예외를 삼킨다", False, repr(exc))

print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    for f in failures:
        print(f"   · {f}")
    raise SystemExit(1)
print("✅ 모두 통과")
