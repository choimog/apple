"""
보관 3단계(확인·정리) 가 정말 안전한지 시험.

【왜 이게 제일 중요한가요? — 2026-08-08】
GitHub 보관은 기한이 지나면 파일이 사라집니다. 그래서 DB 에서 지우는 판단이
틀리면 자료가 **영영** 없어집니다. R2 와 달리 되돌릴 방법이 없습니다.

확인하는 것은 하나입니다.
    "파일이 온전하다고 확인된 것만 지우는가"

파일이 없거나, 깨졌거나, 줄 수가 다르면 **절대 안 지워야** 합니다.

실행: python tests/test_archive_commit.py
※ 인터넷도 DB 도 필요 없습니다. 가짜 DB 로 '무엇을 지우려 했는지' 만 봅니다.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import shutil
import sys
import tempfile
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

fake = types.ModuleType("supabase")
fake.Client = object
fake.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", fake)

from archive import do_commit, pack  # noqa: E402

failures: list[str] = []


def check(name: str, got, want) -> None:
    if got == want:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}\n       나온 값: {got!r}\n       기대 값: {want!r}")
        failures.append(name)


# --------------------------------------------------------------------------
#  가짜 데이터베이스 — 무엇을 지우려 했는지만 기록합니다
# --------------------------------------------------------------------------
class FakeTable:
    def __init__(self, log, name):
        self.log, self.name, self._filters = log, name, {}

    def upsert(self, row, **kw):
        self.log.setdefault("upsert", []).append((self.name, row))
        return self

    def update(self, row):
        self._op = ("update", row)
        return self

    def delete(self):
        self._op = ("delete", None)
        return self

    def eq(self, col, val):
        self._filters[col] = val
        return self

    def execute(self):
        op, _ = getattr(self, "_op", (None, None))
        if op == "delete":
            self.log.setdefault("deleted", []).append(
                (self.name, self._filters.get("snapshot_date"))
            )
        return types.SimpleNamespace(data=[], count=0)


class FakeDB:
    def __init__(self):
        self.log = {}

    def table(self, name):
        return FakeTable(self.log, name)


def build(tmp: Path, corrupt: str = "", drop: str = "") -> tuple[Path, Path]:
    """뽑아낸 파일과 '내려받은' 파일을 만듭니다."""
    rows = [
        {"snapshot_date": "2026-07-01", "category_id": 1, "rank": i,
         "store_book_id": 5000 + i, "sales_point": None}
        for i in range(1, 6)
    ]
    data, digest = pack(rows)

    out, ver = tmp / "out", tmp / "verify"
    (out).mkdir(parents=True, exist_ok=True)
    (ver).mkdir(parents=True, exist_ok=True)

    key = "rankings/2026/07/rankings_2026-07-01.jsonl.gz"
    (out / key).parent.mkdir(parents=True, exist_ok=True)
    (ver / key).parent.mkdir(parents=True, exist_ok=True)
    (out / key).write_bytes(data)

    if drop != key:
        payload = data
        if corrupt == "bytes":
            payload = data[:-3] + b"XYZ"          # 깨진 파일
        elif corrupt == "rows":
            payload, _ = pack(rows[:3])           # 줄 수가 모자란 파일
        (ver / key).write_bytes(payload)

    manifest = [{
        "snapshot_date": "2026-07-01", "table_name": "rankings",
        "object_key": key, "row_count": len(rows),
        "byte_size": len(data), "sha256": digest,
    }]
    (out / "manifest.json").write_text(json.dumps(manifest))
    return out, ver


print("=" * 66)
print("  보관 3단계 — 확인된 것만 지우는가")
print("=" * 66)

tmp = Path(tempfile.mkdtemp())
try:
    print("\n[1] 정상일 때는 지운다")
    out, ver = build(tmp / "ok")
    db = FakeDB()
    do_commit(db, out / "manifest.json", ver, 400, "http://run")
    check("DB 에서 지웠다", db.log.get("deleted"), [("rankings", "2026-07-01")])
    check("보관 기록을 남겼다", len(db.log.get("upsert", [])), 1)
    rec = db.log["upsert"][0][1]
    check("어디에 보관했는지 기록", rec["storage"], "github")
    check("언제 사라지는지 기록", bool(rec["expires_at"]), True)

    print("\n[2] 파일이 깨졌으면 절대 안 지운다")
    out, ver = build(tmp / "corrupt", corrupt="bytes")
    db = FakeDB()
    do_commit(db, out / "manifest.json", ver, 400, "")
    check("지우지 않았다", db.log.get("deleted"), None)
    check("보관 기록도 안 남겼다", db.log.get("upsert"), None)

    print("\n[3] 줄 수가 모자라면 절대 안 지운다")
    out, ver = build(tmp / "rows", corrupt="rows")
    db = FakeDB()
    do_commit(db, out / "manifest.json", ver, 400, "")
    check("지우지 않았다", db.log.get("deleted"), None)

    print("\n[4] 내려받은 파일이 아예 없으면 절대 안 지운다")
    key = "rankings/2026/07/rankings_2026-07-01.jsonl.gz"
    out, ver = build(tmp / "missing", drop=key)
    db = FakeDB()
    do_commit(db, out / "manifest.json", ver, 400, "")
    check("지우지 않았다", db.log.get("deleted"), None)

    print("\n[5] 옮길 것이 없으면 조용히 끝난다")
    empty = tmp / "empty"
    empty.mkdir(parents=True)
    (empty / "manifest.json").write_text("[]")
    db = FakeDB()
    rc = do_commit(db, empty / "manifest.json", empty, 400, "")
    check("정상 종료", rc, 0)
    check("아무것도 안 지웠다", db.log.get("deleted"), None)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print("\n" + "=" * 66)
if failures:
    print(f"  ❌ 실패 {len(failures)}건: {', '.join(failures)}")
    raise SystemExit(1)
print("  ✅ 전부 통과 — 확인된 것만 지웁니다")
raise SystemExit(0)
