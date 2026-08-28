"""
🚨 서점이 우리를 막았을 때, 계속 두드리지 않고 멈추는지 시험.

【2026-08-28 실제로 겪은 일】
알라딘이 우리 수집기를 막았습니다. robots.txt 까지 HTTP 403 이었습니다.
그런데 그날 로그는 이렇게 나왔습니다.

    ✅ aladin: robots.txt 없음(HTTP 403) → 제한 없음

그러고는 **61개 분야를 전부 두드렸습니다.** 하나하나 재시도까지 하면서요.
이미 문 앞에서 거절당한 뒤에 말입니다.

403 은 '규칙 파일이 없다' 가 아닙니다. **'당신은 이 서버에 접근할 수 없다'**
입니다. 둘은 뜻이 정반대인데 한 줄로 뭉뚱그리고 있었습니다.

  · 404 → 규칙을 안 만들어 둔 것 → 제한 없음 (계속해도 됨)
  · 403 → 우리를 막고 있는 것    → 즉시 멈추고 보고

이 시험이 없으면 같은 실수가 조용히 돌아옵니다. 로그가 ✅ 로 보이니까요.

⚠️ 우회는 시험하지 않습니다. 만들지 않기로 했기 때문입니다.
   이름표를 브라우저인 척 바꾸거나 다른 통로로 도는 방법은 대표님이
   "임의로 우회하지 말고 나에게 보고해줘" 라고 명시적으로 금지하셨습니다.

실행: python tests/test_robots_refused.py
※ 인터넷도 데이터베이스도 필요 없습니다 (가짜 응답으로 시험합니다).
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

# 데이터베이스도 인터넷도 없이 돌아야 합니다 (수집 workflow 안에서 매일 돕니다).
# tests/test_count_floor.py 와 같은 방법입니다.
_fake = types.ModuleType("supabase")
_fake.Client = object
_fake.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _fake)

_hx = types.ModuleType("httpx")
for _n in ("Client", "Response", "Request", "Timeout", "Limits", "HTTPError",
           "TimeoutException", "ConnectError", "ReadTimeout", "HTTPStatusError",
           "RequestError"):
    setattr(_hx, _n, type(_n, (Exception,), {}))
sys.modules.setdefault("httpx", _hx)

import run_daily  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


class FakeResponse:
    def __init__(self, status: int, text: str = "") -> None:
        self.status_code = status
        self.text = text


class FakeClient:
    """PoliteClient 인 척하되, 정해진 응답만 돌려줍니다."""

    def __init__(self, responses: list[FakeResponse]) -> None:
        # 마지막 응답은 계속 되풀이합니다 (되물어도 같은 답)
        self._responses = responses
        self.calls: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, url, **kwargs):
        self.calls.append(url)
        i = min(len(self.calls) - 1, len(self._responses) - 1)
        return self._responses[i]


def ask(status: int, body: str = "", *, then: list[tuple[int, str]] = ()) -> tuple:
    """
    robots.txt 가 이렇게 응답할 때 수집을 계속할지 물어봅니다.

    then: 되물었을 때의 응답들. 안 주면 계속 같은 답을 합니다.
    """
    made: dict[str, FakeClient] = {}
    responses = [FakeResponse(status, body)] + [FakeResponse(s, b) for s, b in then]

    def fake_polite_client(**kwargs):
        made["c"] = FakeClient(responses)
        return made["c"]

    original_client = run_daily.PoliteClient
    original_sleep = run_daily.time.sleep
    run_daily.PoliteClient = fake_polite_client
    run_daily.time.sleep = lambda _s: None   # 시험이 15초를 기다릴 이유가 없습니다
    try:
        allowed, why = run_daily.robots_allows(
            "https://example.test",
            "https://example.test/best?page=1",
            "BestsellerTracker/1.0",
            "example",
        )
    finally:
        run_daily.PoliteClient = original_client
        run_daily.time.sleep = original_sleep
    return allowed, why, made["c"]


# ---------------------------------------------------------------------------
print("\n[1] 🚨 robots.txt 가 403 이면 멈춘다 (실제 사고)")

allowed, why, _ = ask(403)
check("403 → 수집을 계속하지 않는다", allowed is False, allowed)
check("이유에 403 이 적힌다", "403" in why, why)
check(
    "'접속 자체가 막혔다' 고 적는다 ('경로 금지' 와 구분)",
    "접속" in why,
    why,
)

allowed, why, _ = ask(401)
check("401(인증 요구)도 같게 본다", allowed is False, allowed)


# ---------------------------------------------------------------------------
print("\n[2] 404 는 예전 그대로 — '규칙이 없다' 이지 '막혔다' 가 아니다")
# 여기까지 막아 버리면, robots.txt 를 안 만들어 둔 서점을 통째로 못 읽습니다.

allowed, why, _ = ask(404)
check("404 → 제한 없음으로 계속한다", allowed is True, allowed)
check("404 는 이유를 안 남긴다 (막힌 게 아니므로)", why == "", why)


# ---------------------------------------------------------------------------
print("\n[3] 규칙을 실제로 읽어서 판단하는 부분은 그대로다")

ALLOW_ALL = "User-agent: *\nAllow: /\n"
allowed, why, _ = ask(200, ALLOW_ALL)
check("허용하면 계속한다", allowed is True, allowed)

DENY_ALL = "User-agent: *\nDisallow: /\n"
allowed, why, _ = ask(200, DENY_ALL)
check("금지하면 멈춘다", allowed is False, allowed)
check("이유가 '경로 금지' 로 적힌다", "허용하지 않습니다" in why, why)

# 다른 봇에게만 건 금지를 우리 것으로 착각하면 안 됩니다 (교보가 이 구조)
OTHER_BOT = "User-agent: *\nAllow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n"
allowed, _, _ = ask(200, OTHER_BOT)
check("남에게 건 금지를 우리 것으로 읽지 않는다", allowed is True, allowed)


# ---------------------------------------------------------------------------
print("\n[3-1] 🚨 몇 초짜리 깜빡임에 하루치를 날리지 않는다")
"""
2026-08-28 알라딘은 **몇 시간 만에 저절로 풀렸습니다.** 일시적이었습니다.

그러면 이런 위험이 생깁니다 — robots.txt 를 가져오는 그 순간에 하필
걸리면, 그날 그 서점 자료를 통째로 못 받습니다. 예전 코드였다면
멀쩡히 받았을 자료를요. **고치려다 새 고장을 만드는 셈입니다.**

그래서 한 번으로 단정하지 않고 되물어봅니다.
"""
allowed, _, client = ask(403, then=[(200, ALLOW_ALL := "User-agent: *\nAllow: /\n")])
check("첫 번에 403 이어도 두 번째에 열리면 수집한다", allowed is True, allowed)
check("되물어봤다 (2번)", len(client.calls) == 2, client.calls)

allowed, _, client = ask(403, then=[(403, ""), (200, ALLOW_ALL)])
check("세 번째에 열려도 수집한다", allowed is True, allowed)

allowed, _, client = ask(403)   # 계속 403
check("세 번 다 거절이면 그때 멈춘다", allowed is False, allowed)
check("세 번까지만 되묻는다", len(client.calls) == 3, client.calls)

# ⚠️ 평소에는 되묻기가 아예 없어야 합니다. 서점에 보내는 요청이 늘면 안 됩니다.
_, _, client = ask(200, ALLOW_ALL)
check("🚨 정상일 때는 되묻지 않는다 (요청이 안 늘어난다)", len(client.calls) == 1, client.calls)
_, _, client = ask(404)
check("404 일 때도 되묻지 않는다", len(client.calls) == 1, client.calls)


# ---------------------------------------------------------------------------
print("\n[4] 🚨 막힌 서점에 요청을 더 보내지 않는다")
# 이게 이 시험의 핵심입니다. 예전에는 여기서 61개 분야를 더 두드렸습니다.

_, _, client = ask(403)
check(
    "막혔다고 결론 내기까지 robots.txt 만 물어본다",
    all(u.endswith("/robots.txt") for u in client.calls),
    client.calls,
)
check(
    "목록 페이지는 한 번도 안 두드린다",
    not any("best" in u for u in client.calls),
    client.calls,
)


# ---------------------------------------------------------------------------
print("\n[5] 🚨 연달아 막히면 그 서점은 그만 두드린다")
"""
robots.txt 는 열어 주는데 **목록 페이지만** 막는 경우가 있습니다.
그러면 위 [1] 의 장치로는 못 막습니다 — robots 는 통과했으니까요.
그때 61개 분야를 끝까지 두드리면 8/28 과 똑같은 일이 벌어집니다.
"""
from run_daily import BlockStreak  # noqa: E402


def attempted(outcomes: list[bool], limit: int = 3) -> int:
    """실제 루프와 **같은 부품**으로, 요청을 실제로 보낸 분야 수를 셉니다."""
    s = BlockStreak(limit=limit)
    n = 0
    for ok in outcomes:
        if s.stopped:
            continue          # 요청을 안 보냅니다
        n += 1
        s.ok() if ok else s.blocked()
    return n


check(
    "전부 막히면 3개까지만 두드린다 (61개 → 3개)",
    attempted([False] * 61) == 3,
    attempted([False] * 61),
)
check(
    "🚨 한 번 실패는 나머지를 포기하지 않는다",
    attempted([True, False, True, False, True]) == 5,
    attempted([True, False, True, False, True]),
)
check(
    "두 번 연달아까지는 계속한다 (일시적일 수 있음)",
    attempted([False, False, True, False, False, True]) == 6,
    attempted([False, False, True, False, False, True]),
)
check(
    "중간에 되면 셈이 0 으로 돌아간다",
    attempted([False, False, True, False, False, False, False, False]) == 6,
    attempted([False, False, True, False, False, False, False, False]),
)
check("전부 되면 전부 두드린다", attempted([True] * 10) == 10)

s = BlockStreak(limit=3)
check("한도에 '막 닿는' 순간에만 알린다", [s.blocked() for _ in range(5)][:4]
      == [False, False, True, False])


print("\n[6] 🚨 우회하는 길을 만들어 두지 않았다")
"""
대표님 지시: "robots.txt 를 먼저 확인하고, 허용 범위 안에서만 수집…
금지된 경로가 있으면 임의로 우회하지 말고 나에게 보고해줘."

막혔을 때 이름표(User-Agent)를 브라우저인 척 바꾸거나, 다른 통로(프록시)로
도는 코드가 **있으면 안 됩니다.** 한 번 만들어 두면 다음 사람이 씁니다.
"""
src = (ROOT / "crawler" / "run_daily.py").read_text(encoding="utf-8")
http_src = (ROOT / "crawler" / "common" / "http.py").read_text(encoding="utf-8")
both = src + http_src

for word in ("proxy", "proxies", "Mozilla/", "Chrome/", "Safari/"):
    check(f"'{word}' 로 위장·우회하는 코드가 없다", word not in both)

# 이름표는 우리를 밝히는 것이어야 합니다 (연락처 포함)
cfg = (ROOT / "config" / "sources.yaml").read_text(encoding="utf-8")
check(
    "이름표에 우리가 누구인지와 연락처가 들어 있다",
    "BestsellerTracker" in cfg and "github.com/choimog/apple" in cfg,
)


# ---------------------------------------------------------------------------
print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    raise SystemExit(1)
print("✅ 모두 통과")
