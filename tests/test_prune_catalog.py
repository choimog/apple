"""
🚨 도서 목록 정리가 지우면 안 되는 것을 지우지 않는지 봅니다.

【2026-08-18 대표님 지시】
  "14일 동안 단 한 차례도 사용되지 않거나 업데이트 되지 않는 데이터들은
   제거 또는 보관함으로 알아서 보내주면 좋겠어.
   대신, 3사 서점 중에 단 한 차례라도 쓰였다면 지울 수 없도록 해주고."

이 작업은 **되돌릴 수 없습니다.** 그래서 시험이 두 가지를 봅니다.

  ① 고르는 규칙(SQL)이 대표님 지시 그대로인가 — 글자로 확인
  ② 지우는 순서와 안전장치(파이썬)가 맞는가 — 실제로 돌려서 확인

⚠️ 규칙 자체는 데이터베이스 안(db/prune-catalog.sql)에서 도는 SQL 이라
   여기서 실행할 수 없습니다. 대신 **그 SQL 이 우리가 합의한 조건을
   빠뜨리지 않았는지** 글자로 확인합니다. 조건 하나가 빠지면 지우면 안
   되는 것이 지워지는데, 로그에는 "정리 완료" 라고만 찍힙니다.

실행: python tests/test_prune_catalog.py
※ 인터넷도 DB 도 필요 없습니다.
"""

from __future__ import annotations

import gzip
import json
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

# 시험은 DB 없이 돌아야 합니다
_fake = types.ModuleType("supabase")
_fake.Client = object
_fake.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _fake)

import prune_catalog as pc  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


SQL = (ROOT / "db" / "prune-catalog.sql").read_text(encoding="utf-8")
# 주석(-- …)을 뺀 '진짜 도는 부분' 만 봅니다. 주석에 적어 두고 실제로는
# 안 넣은 경우를 잡기 위해서입니다.
CODE = "\n".join(
    line.split("--")[0] for line in SQL.splitlines()
)

print("\n[1] 🚨 '살아 있다' 의 세 조건이 전부 들어 있는가")
check("㉠ 최근 N일 안에 보였으면 살아 있다 (last_seen_at)",
      "last_seen_at >= now()" in CODE.replace("\n", " ").replace("  ", " "),
      "이게 빠지면 매일 보이는 책까지 지웁니다")
check("㉡ 순위가 남아 있으면 살아 있다 (rankings)",
      "rankings r" in CODE and "r.store_book_id = sb.id" in CODE,
      "🚨 이게 빠지면 상품을 지울 때 순위 기록이 딸려서 함께 지워집니다")
check("㉢ 대표님 결정이 걸렸으면 살아 있다",
      "manual_merge" in CODE and "manual_split" in CODE,
      "이게 빠지면 손으로 하신 검토가 통째로 사라집니다")

print("\n[2] 🚨 3사 중 한 서점이라도 살아 있으면 묶음 전체를 남기는가")
# 대표님 지시의 핵심입니다. 이게 빠지면 교보에서만 팔리는 책의
# 예스24·알라딘 줄이 지워져서, 사이트가 "안 묶임" 이라고 잘못 적습니다.
check("살아 있는 묶음 목록을 따로 만든다 (alive_books)",
      "alive_books" in CODE)
check("그 묶음에 속하면 잠들었어도 안 지운다",
      "NOT EXISTS" in CODE and "ab.book_id = sb.book_id" in CODE,
      "🚨 이 한 줄이 대표님 지시 그 자체입니다")
check("안 묶인 상품(book_id 없음)은 혼자 판단한다",
      "book_id IS NOT NULL" in CODE,
      "NULL 이 섞이면 NOT IN 이 아무것도 안 돌려줍니다")

print("\n[3] 계산은 아무것도 지우지 않는다")
for word in ("DELETE", "TRUNCATE", "DROP TABLE", "UPDATE "):
    check(f"SQL 에 {word} 가 없다", word not in CODE.upper(),
          "고르기만 해야 합니다. 지우는 일은 파이썬이 확인 뒤에 합니다")

print("\n[4] 사이트 방문자는 이 계산을 못 부른다")
check("anon 에 권한을 주지 않는다", "TO anon" not in CODE)
check("service_role 에만 준다", "TO service_role" in CODE)
check("먼저 전부 회수한다", CODE.count("REVOKE ALL ON FUNCTION") >= 3)

print("\n[5] 🚨 최소 14일은 코드에 박혀 있는가")
check("ABSOLUTE_MIN_DAYS 가 14", pc.ABSOLUTE_MIN_DAYS == 14, pc.ABSOLUTE_MIN_DAYS)


class _Q:
    """PostgREST 흉내. 무엇을 지웠는지 기록만 합니다."""

    def __init__(self, log, table):
        self.log, self.table = log, table
        self._ids = None
        self._count = None

    def select(self, *a, **k):
        self._count = k.get("count")
        return self

    def in_(self, col, vals):
        self._ids = list(vals)
        return self
    # 파이썬 예약어 회피용 별칭 (supabase-py 는 in_ 을 씁니다)

    def order(self, *a, **k):
        return self

    def delete(self):
        self.log.append(("delete", self.table, None))
        return self

    def update(self, *a, **k):
        return self

    def upsert(self, row, **k):
        self.log.append(("upsert", self.table, row.get("table_name")))
        return self

    def eq(self, *a, **k):
        return self

    def execute(self):
        if self.log and self.log[-1][0] == "delete" and self.log[-1][2] is None:
            self.log[-1] = ("delete", self.table, list(self._ids or []))
        if self._count == "exact":
            return types.SimpleNamespace(count=_FakeClient.manual_now, data=[])
        return types.SimpleNamespace(data=_FakeClient.rows.get(self.table, []),
                                     count=None)


class _FakeClient:
    rows: dict = {}
    manual_now = 21

    def __init__(self):
        self.log: list = []

    def table(self, name):
        return _Q(self.log, name)

    def rpc(self, name, params):
        return types.SimpleNamespace(
            execute=lambda: types.SimpleNamespace(data=_FakeClient.rows.get(name, []))
        )


print("\n[6] 🚨 지우는 순서 — 상품이 먼저, 묶음이 나중")
# 반대로 하면 묶음이 없어진 상품이 잠깐 생깁니다. 그 사이에 매칭이 돌면
# 엉뚱하게 다시 묶습니다.
# ⚠️ 시험이 만든 파일은 저장소에 남기지 않습니다.
import atexit  # noqa: E402
import shutil  # noqa: E402
import tempfile  # noqa: E402

tmp = Path(tempfile.mkdtemp(prefix="prune-test-"))
atexit.register(shutil.rmtree, tmp, True)

rows_sb = [{"id": 1, "raw_title": "가"}, {"id": 2, "raw_title": "나"}]
rows_bk = [{"id": 10, "title": "가"}]
sb_data, sb_hash = pc.pack(rows_sb)
bk_data, bk_hash = pc.pack(rows_bk)
(tmp / "sb.jsonl.gz").write_bytes(sb_data)
(tmp / "bk.jsonl.gz").write_bytes(bk_data)

manifest = [
    {"snapshot_date": "2026-08-18", "table_name": "store_books",
     "object_key": "sb.jsonl.gz", "row_count": 2, "byte_size": len(sb_data),
     "sha256": sb_hash, "ids": [1, 2]},
    {"snapshot_date": "2026-08-18", "table_name": "books",
     "object_key": "bk.jsonl.gz", "row_count": 1, "byte_size": len(bk_data),
     "sha256": bk_hash, "ids": [10]},
]
mpath = tmp / "manifest.json"
mpath.write_text(json.dumps(manifest))

_FakeClient.rows = {"orphan_books": []}
c = _FakeClient()
rc = pc.do_commit(c, mpath, tmp, 90, "")
dels = [(t, ids) for kind, t, ids in c.log if kind == "delete"]
check("정상 종료", rc == 0, rc)
check("상품을 먼저 지운다", dels and dels[0][0] == "store_books", dels)
check("묶음을 나중에 지운다", len(dels) >= 2 and dels[1][0] == "books", dels)
check("고른 번호만 지운다", dels[0][1] == [1, 2], dels[0][1])

print("\n[7] 🚨 파일이 깨졌으면 아무것도 안 지운다")
bad = json.loads(json.dumps(manifest))
bad[0]["sha256"] = "0" * 64
bpath = tmp / "bad.json"
bpath.write_text(json.dumps(bad))
c2 = _FakeClient()
rc2 = pc.do_commit(c2, bpath, tmp, 90, "")
check("실패로 끝난다", rc2 == 1, rc2)
check("한 줄도 안 지웠다",
      not [1 for k, _, _ in c2.log if k == "delete"], c2.log)

print("\n[7-1] 줄 수가 다르면 안 지운다")
bad2 = json.loads(json.dumps(manifest))
bad2[0]["row_count"] = 99
b2 = tmp / "bad2.json"
b2.write_text(json.dumps(bad2))
c3 = _FakeClient()
check("실패로 끝난다", pc.do_commit(c3, b2, tmp, 90, "") == 1)
check("한 줄도 안 지웠다",
      not [1 for k, _, _ in c3.log if k == "delete"], c3.log)

print("\n[7-2] 파일이 아예 없으면 안 지운다")
gone = json.loads(json.dumps(manifest))
gone[0]["object_key"] = "없는파일.gz"
g = tmp / "gone.json"
g.write_text(json.dumps(gone))
c4 = _FakeClient()
check("실패로 끝난다", pc.do_commit(c4, g, tmp, 90, "") == 1)
check("한 줄도 안 지웠다",
      not [1 for k, _, _ in c4.log if k == "delete"], c4.log)

print("\n[8] 🚨 대표님 결정이 줄면 실패로 끝난다")
# 이게 줄었다는 건 어딘가에서 딸려 지워졌다는 뜻입니다.
# 조용히 넘어가면 8만 건의 검토가 사라진 것을 몇 주 뒤에나 알게 됩니다.


class _Shrink(_FakeClient):
    def __init__(self):
        super().__init__()
        self.n = 0

    def table(self, name):
        q = _Q(self.log, name)
        if name == "book_matches":
            self.n += 1
            _FakeClient.manual_now = 21 if self.n == 1 else 20
        return q


_FakeClient.manual_now = 21
c5 = _Shrink()
check("결정이 줄면 실패로 끝난다", pc.do_commit(c5, mpath, tmp, 90, "") == 1)
_FakeClient.manual_now = 21

print("\n[9] 보관 파일에 되살릴 만큼 담기는가")
# 제목이 안 담기면 보관소의 옛날 순위 파일은 '번호만 남은 종이' 가 됩니다.
for col in ("raw_title", "raw_author", "raw_publisher", "store_book_key",
            "store_id", "list_price", "book_id"):
    check(f"상품에 {col} 이(가) 담긴다", col in pc.STORE_BOOK_COLS)
for col in ("title", "author", "publisher"):
    check(f"묶음에 {col} 이(가) 담긴다", col in pc.BOOK_COLS)

print("\n[10] 담은 것을 그대로 풀 수 있는가")
back = [json.loads(x) for x in
        gzip.decompress(sb_data).decode().strip().split("\n")]
check("담기·풀기가 왕복한다", back == rows_sb, back)

print("\n[11] 설정과 코드가 같은 숫자를 말하는가")
import yaml  # noqa: E402

acfg = yaml.safe_load((ROOT / "config" / "archive.yaml").read_text(encoding="utf-8"))
check("archive.yaml 에 catalog_keep_days 가 있다",
      "catalog_keep_days" in acfg, list(acfg))
check(f"14일 이상이다 (지금 {acfg.get('catalog_keep_days')}일)",
      int(acfg.get("catalog_keep_days", 0)) >= pc.ABSOLUTE_MIN_DAYS)

print("\n[12] 🚨 보관소가 먼저, 정리가 나중인가")
wf = (ROOT / ".github" / "workflows" / "prune-catalog.yml").read_text(encoding="utf-8")
arc = (ROOT / ".github" / "workflows" / "archive.yml").read_text(encoding="utf-8")
check("보관소가 끝난 뒤에 돈다",
      'workflows: ["보관소로 옮기기"]' in wf,
      "순위가 안 빠진 상태에서 상품을 건드리면 안 됩니다")
check("보관소가 실패했으면 안 돈다",
      "workflow_run.conclusion == 'success'" in wf)
check("손으로 누르면 확인만 하는 게 기본",
      'default: "true"' in wf)
check("🚨 보관소가 매일 돈다 (주 1회면 정리도 주 1회가 됩니다)",
      'cron: "0 23 * * *"' in arc,
      "주 1회면 순위가 최대 21일치까지 남아 상품을 못 지웁니다")
check("지우기 전에 이 시험을 돌린다",
      "test_prune_catalog.py" in wf)

print("\n[13] 🚨 세어 보다 죽어도 정리는 계속되는가 (2026-08-27 실제 사고)")
"""
그날 '얼마나 지워질지 세어 보기' 가 시간 초과(57014)로 죽으면서,
**그 뒤의 실제 정리가 시작조차 못 했습니다.** 악순환이 시작됐습니다.
    정리 안 됨 → 목록 커짐 → 더 느려짐 → 또 시간 초과

세어 보기는 화면에 숫자를 찍는 것뿐이라 넘어져도 됩니다.
진짜 안전장치는 그 뒤(뽑아내기 → 올리기 → 내려받아 확인 → 그때야 지움)입니다.
"""
# 각 단계가 어디서 시작하는지 잘라서 봅니다
def step_block(name: str) -> str:
    i = wf.index(f"- name: {name}")
    j = wf.find("\n      - name:", i + 1)
    return wf[i:j if j > 0 else len(wf)]

count_block = step_block("얼마나 지워질지 먼저 세어 봅니다")
check("세어 보기가 넘어져도 계속 간다",
      "continue-on-error: true" in count_block,
      "여기서 멈추면 정리가 영영 안 돕니다")

# 🚨 반대로, 진짜 안전장치에는 절대 붙으면 안 됩니다.
for name in ("뽑아내기 (DB 는 손대지 않습니다)", "확인하고 DB 정리", "안전장치 시험"):
    check(f"🚨 '{name}' 은 넘어가지 않는다",
          "continue-on-error" not in step_block(name),
          "여기서 넘어가면 확인 안 된 것을 지웁니다")

print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    for f in failures:
        print(f"   · {f}")
    raise SystemExit(1)
print("✅ 모두 통과")
