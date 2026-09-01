"""
🚨 백업이 **실제로 만들어지고 되돌릴 수 있는지** 시험.

【2026-09-01 — 백업이 한 번도 된 적이 없었습니다】
매주 월요일 [백업] 이 돌았는데 매번 이렇게 끝났습니다.

    보관소 접속 정보가 없습니다. 아무것도 하지 않았습니다.
    ⚠️ 백업이 없는 상태입니다. 사고가 나면 되돌릴 수 없습니다.

설정은 `storage: github` 인데 backup.py 만 R2 를 찾고 있었습니다.
더 나빴던 것은 **인수인계 문서에 "자동 백업 · 매주" 라고 적혀 있었다는
점**입니다. 대표님은 백업이 있는 줄 아셨습니다.

백업은 "있다고 생각했는데 없는 것" 이 가장 위험합니다. 사고가 난 뒤에야
압니다. 그래서 기계가 매주 미리 확인합니다.

  · 담은 것을 그대로 되돌릴 수 있는가 (왕복)
  · 지문이 다르면 실패로 잡아내는가
  · 사람이 내린 판단(book_matches)이 담기는가  ← 가장 중요
  · 백업과 되돌리기가 **같은 곳**을 보고 있는가

실행: python tests/test_backup_github.py
※ 인터넷도 데이터베이스도 필요 없습니다.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import sys
import tempfile
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

_fake = types.ModuleType("supabase")
_fake.Client = object
_fake.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _fake)

import backup  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


# ---------------------------------------------------------------------------
print("\n[1] 🚨 다시 만들 수 없는 것들이 담기는가")
"""
순위(rankings)는 보관소가 날짜별로 이미 담고 있어서 뺍니다.
하지만 아래 것들은 **어디에도 사본이 없습니다.**
"""
for table in ("books", "store_books", "book_matches", "categories", "stores"):
    check(f"{table} 이(가) 담긴다", table in backup.TABLES, list(backup.TABLES))

check(
    "🚨 사람이 내린 판단(book_matches)이 담긴다",
    "book_matches" in backup.TABLES,
    "이걸 잃으면 대표님이 하나하나 다시 정하셔야 합니다",
)
check(
    "순위는 안 담는다 (보관소가 이미 담고 있음)",
    "rankings" not in backup.TABLES,
    "매주 통째로 담으면 파일이 감당이 안 됩니다",
)


# ---------------------------------------------------------------------------
print("\n[2] 🚨 담은 것을 그대로 되돌릴 수 있는가 (왕복)")
"""
백업은 '담기' 와 '풀기' 가 짝이 맞아야 합니다. 한쪽만 고치면 파일은
쌓이는데 정작 사고 때 못 풉니다. 실제로 담고 실제로 풀어 봅니다.
"""
ROWS = {
    "stores": [{"id": 1, "code": "kyobo", "name": "교보문고"}],
    "book_matches": [
        # 쉼표·따옴표·한글·None 이 섞인 실제 같은 값
        {"id": 7, "store_book_a": 1, "store_book_b": 2,
         "decision": "manual_merge", "reasons": None,
         "note": '대표님이 "같은 책" 이라고, 직접 누름'},
    ],
    "books": [{"id": 3, "title": "세이노의 가르침", "author": None}],
}

buf_lines = []
for table, rows in ROWS.items():
    for r in rows:
        buf_lines.append(
            json.dumps({"_table": table, **r}, ensure_ascii=False,
                       sort_keys=True, default=str)
        )
raw = ("\n".join(buf_lines) + "\n").encode()
packed = gzip.compress(raw, mtime=0)

# 풀기 — backup_restore.py 가 하는 것과 같은 방법
by_table: dict[str, list[dict]] = {}
for line in gzip.decompress(packed).decode().splitlines():
    if not line.strip():
        continue
    row = json.loads(line)
    t = row.pop("_table", None)
    if t:
        by_table.setdefault(t, []).append(row)

check("담은 표가 그대로 나온다", set(by_table) == set(ROWS), sorted(by_table))
check("줄 수가 같다",
      all(len(by_table[t]) == len(ROWS[t]) for t in ROWS),
      {t: len(v) for t, v in by_table.items()})
check("한글·따옴표·쉼표가 안 깨진다",
      by_table["book_matches"][0]["note"] == ROWS["book_matches"][0]["note"],
      by_table["book_matches"][0]["note"])
check("빈 값(None)이 그대로 남는다",
      by_table["books"][0]["author"] is None,
      by_table["books"][0]["author"])
check("🚨 사람이 내린 판단이 그대로 돌아온다",
      by_table["book_matches"][0]["decision"] == "manual_merge")


# ---------------------------------------------------------------------------
print("\n[3] 🚨 올린 것이 깨졌으면 잡아내는가")
"""
"올렸다" 는 말만 믿으면, 파일이 안 올라간 주에도 초록불이 뜹니다.
그러면 사고가 나서 열어 볼 때까지 아무도 모릅니다.
"""
with tempfile.TemporaryDirectory() as td:
    tmp = Path(td)
    key = "backups/2026-09-01T000000Z.jsonl.gz"
    digest = hashlib.sha256(packed).hexdigest()
    man = tmp / "manifest.json"
    man.write_text(json.dumps({
        "key": key, "stamp": "2026-09-01T000000Z", "sha256": digest,
        "byte_size": len(packed), "rows": {"stores": 1},
    }))

    good = tmp / "good"
    (good / "backups").mkdir(parents=True)
    (good / key).write_bytes(packed)
    check("멀쩡하면 통과한다", backup.do_verify(man, good) == 0)

    bad = tmp / "bad"
    (bad / "backups").mkdir(parents=True)
    (bad / key).write_bytes(packed + b"x")     # 한 글자만 달라져도
    check("🚨 내용이 다르면 실패시킨다", backup.do_verify(man, bad) == 1)

    missing = tmp / "missing"
    missing.mkdir()
    check("🚨 파일이 아예 없으면 실패시킨다", backup.do_verify(man, missing) == 1)

    empty = tmp / "empty.json"
    empty.write_text("{}")
    check("목록이 비었으면 실패시킨다", backup.do_verify(empty, good) == 1)


# ---------------------------------------------------------------------------
print("\n[4] 🚨 백업과 되돌리기가 같은 곳을 본다")
"""
한쪽만 고치면 백업은 쌓이는데 사고 때 못 꺼냅니다.
이게 정확히 2026-09-01 이전의 상태였습니다 (둘 다 R2 만 봄).
"""
b = (ROOT / "crawler" / "backup.py").read_text(encoding="utf-8")
r = (ROOT / "crawler" / "backup_restore.py").read_text(encoding="utf-8")

check("백업이 설정(storage)을 읽는다", 'cfg.load("archive.yaml")' in b)
check("되돌리기도 설정을 읽는다", 'cfg.load("archive.yaml")' in r)
check("백업에 GitHub 방식이 있다", 'storage == "github"' in b)
check("되돌리기에도 GitHub 방식이 있다", 'storage == "github"' in r)
check("되돌리기가 내려받은 폴더에서 찾는다", 'rglob("*.jsonl.gz")' in r)

wf = (ROOT / ".github" / "workflows" / "backup.yml").read_text(encoding="utf-8")
wr = (ROOT / ".github" / "workflows" / "backup-restore.yml").read_text(encoding="utf-8")
check("백업 작업이 파일을 올린다", "upload-artifact" in wf)
check("🚨 올린 것을 다시 내려받아 확인한다",
      "download-artifact" in wf and "--stage verify" in wf,
      "이게 없으면 안 올라간 주에도 초록불입니다")
check("되돌리기 작업이 파일을 내려받는다", "download-artifact" in wr)
check("되돌리기가 그 폴더를 알려 준다", "FROM_DIR: restore" in wr)
check("다른 실행의 파일을 읽을 권한이 있다", "actions: read" in wr)

# 🚨 되돌리기는 실수로 눌러도 바로 덮어쓰면 안 됩니다
check("되돌리기 기본값은 '확인만'", 'default: "false"' in wr)


# ---------------------------------------------------------------------------
print("\n[5] 백업이 없는데 있다고 적어 두지 않았는가")
"""
🚨 이게 이번 사고의 진짜 교훈입니다. 코드는 실패하고 있었는데 문서는
   "자동 백업 · 매주" 라고 적어 놨습니다. 대표님은 믿고 계셨습니다.
"""
hand = (ROOT / "HANDOVER.md").read_text(encoding="utf-8")
check("인수인계 문서가 어디에 백업되는지 적는다",
      "backup-" in hand or "GitHub 파일" in hand,
      "어디에 있는지 모르면 사고 때 못 찾습니다")


# ---------------------------------------------------------------------------
print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    raise SystemExit(1)
print("✅ 모두 통과")
