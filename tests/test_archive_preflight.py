"""
보관 작업이 '준비 안 된 상태' 를 사람 말로 알려주는지 시험.

【왜 필요한가요? — 2026-08-09】
보관 기록표가 없는 상태로 작업을 돌렸더니 파이썬 오류 화면이 그대로
떴습니다. 개발 지식이 없으면 그 화면만 봐서는 무엇을 해야 할지 알 수
없습니다. 안내문이 상황에 맞게 나오는지 확인합니다.

실행: python tests/test_archive_preflight.py
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

fake = types.ModuleType("supabase")
fake.Client = object
fake.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", fake)

from archive import archives_ready  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got else ""))
        failures.append(name)


class Boom:
    """무슨 말이든 뱉는 가짜 DB"""
    def __init__(self, msg): self.msg = msg
    def table(self, _): raise Exception(self.msg)


class Fine:
    """정상인 가짜 DB"""
    def table(self, _): return self
    def select(self, *a, **k): return self
    def limit(self, *a): return self
    def execute(self): return types.SimpleNamespace(data=[])


print("=" * 66)
print("  보관 작업 준비 상태 안내")
print("=" * 66)

print("\n[1] 표가 아예 없을 때")
got = archives_ready(Boom(
    "{'code': 'PGRST205', 'message': \"Could not find the table "
    "'public.archives' in the schema cache\"}"
))
check("표가 없다고 알려준다", "기록표(archives)가 아직 없습니다" in got, got)
check("무엇을 해야 하는지 알려준다", "archive_schema.sql" in got, got)

print("\n[2] 표는 있는데 칸이 모자랄 때")
# ⚠️ 이 메시지에는 'archives' 와 'does not exist' 가 둘 다 들어 있습니다.
#    차례를 잘못 두면 [1] 번 안내가 나가 버립니다. 실제로 그랬습니다.
got = archives_ready(Boom(
    "{'code': '42703', 'message': 'column archives.expires_at does not exist'}"
))
check("칸이 없다고 알려준다", "칸이 몇 개 없습니다" in got, got)
check("표가 없다고 잘못 말하지 않는다", "아직 없습니다" not in got, got)

print("\n[3] 정상일 때")
check("빈 값을 돌려준다", archives_ready(Fine()) == "")

print("\n[4] 모르는 오류일 때")
got = archives_ready(Boom("무언가 이상한 오류"))
check("그래도 뭔가 알려준다", len(got) > 0, got)
check("원래 메시지를 감추지 않는다", "무언가 이상한 오류" in got, got)

print("\n" + "=" * 66)
if failures:
    print(f"  ❌ 실패 {len(failures)}건: {', '.join(failures)}")
    raise SystemExit(1)
print("  ✅ 전부 통과")
raise SystemExit(0)
