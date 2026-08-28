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

    def __init__(self, response: FakeResponse) -> None:
        self._response = response
        self.calls: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, url, **kwargs):
        self.calls.append(url)
        return self._response


def ask(status: int, body: str = "") -> tuple[bool, str, FakeClient]:
    """robots.txt 가 이렇게 응답할 때 수집을 계속할지 물어봅니다."""
    made: dict[str, FakeClient] = {}

    def fake_polite_client(**kwargs):
        made["c"] = FakeClient(FakeResponse(status, body))
        return made["c"]

    original = run_daily.PoliteClient
    run_daily.PoliteClient = fake_polite_client
    try:
        allowed, why = run_daily.robots_allows(
            "https://example.test",
            "https://example.test/best?page=1",
            "BestsellerTracker/1.0",
            "example",
        )
    finally:
        run_daily.PoliteClient = original
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
print("\n[4] 🚨 막힌 서점에 요청을 더 보내지 않는다")
# 이게 이 시험의 핵심입니다. 예전에는 여기서 61개 분야를 더 두드렸습니다.

_, _, client = ask(403)
check(
    "robots.txt 한 번만 물어보고 끝낸다",
    len(client.calls) == 1,
    client.calls,
)
check("물어본 것이 robots.txt 다", client.calls[0].endswith("/robots.txt"), client.calls)


# ---------------------------------------------------------------------------
print("\n[5] 🚨 우회하는 길을 만들어 두지 않았다")
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
