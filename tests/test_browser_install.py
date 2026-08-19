"""
브라우저(크로미움) 설치가 다시는 몇 시간씩 멈추지 않게 못 박는 시험.

【무슨 사고가 있었나요? — 2026-08-19】
'매일 수집' 의 교보문고 작업이 브라우저 설치에서 멈췄습니다.
전날에는 36초 걸리던 단계인데, 88분을 넘겨도 안 끝나서 대표님이 끊으셨고,
다시 돌려도 또 멈췄습니다.

원인은 우리 코드가 아니라 **우분투 꾸러미 창고(apt)** 였습니다.
`playwright install --with-deps` 는 브라우저를 내려받기 전에 apt 로
시스템 라이브러리를 먼저 깝니다. 그날 그 창고가 아주 느렸고,
apt 는 느린 창고를 **스스로 포기하지 않습니다.**

그래서 두 가지를 정해 두었습니다.

  ① 설치 방법은 .github/actions/browser/action.yml 한 곳에만 적는다
     (예전엔 6개 작업에 같은 줄을 복사해 뒀습니다. 같은 일을 여섯 군데
      적어 두면 반드시 어긋납니다)
  ② 그 안의 모든 기다림에는 **시간 제한이 있다**

이 시험은 그 두 가지가 지워지지 않았는지 봅니다.
시간 제한을 없애는 순간 8/19 사고가 그대로 돌아옵니다.

실행: python tests/test_browser_install.py
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
WF = ROOT / ".github" / "workflows"
ACTION = ROOT / ".github" / "actions" / "browser" / "action.yml"
USES = "./.github/actions/browser"

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


# ---------------------------------------------------------------------------
print("\n[1] 🚨 설치 방법이 한 곳에만 적혀 있다 (실제 사고)")

check("공용 파일이 있다", ACTION.exists(), ACTION)

doc = yaml.safe_load(ACTION.read_text(encoding="utf-8"))
steps = (doc.get("runs") or {}).get("steps") or []
script = "\n".join(s.get("run", "") for s in steps)

# 어느 작업이든 브라우저를 깔려면 이 파일을 불러야 합니다.
# 직접 `playwright install` 을 적어 두면 시간 제한이 없는 옛날 방식입니다.
for path in sorted(WF.glob("*.yml")):
    text = path.read_text(encoding="utf-8")
    if "playwright install" not in text:
        continue
    check(f"{path.name} 은 공용 파일을 부른다", USES in text and "--with-deps" not in text, text)

# 브라우저가 필요한 작업들. 새 작업을 만들면 여기에도 이름을 적어 주세요.
# (적어 두지 않으면 그 작업만 옛날 방식으로 돌아가도 아무도 모릅니다)
BROWSER_JOBS = [
    "daily-crawl.yml",        # 매일 수집 — 교보문고
    "check-sources.yml",      # 서점 화면이 바뀌었는지 점검
    "probe-catalog.yml",
    "probe-kyobo-card.yml",
    "probe-kyobo-speed.yml",
    "probe-kyobo-network.yml",
]
for name in BROWSER_JOBS:
    text = (WF / name).read_text(encoding="utf-8")
    check(f"{name} 이 공용 파일을 부른다", USES in text, text[:200])


# ---------------------------------------------------------------------------
print("\n[2] 🚨 기다림에는 모두 시간 제한이 있다 (이게 사고의 핵심)")

# apt 쪽 — 여기가 88분 멈춘 곳입니다. 제한 없이 부르면 안 됩니다.
deps = [ln for ln in script.splitlines() if "install-deps" in ln]
check("시스템 라이브러리(apt) 를 따로 부른다", bool(deps), script)
check("그 부름에는 timeout 이 붙어 있다",
      bool(deps) and all("timeout " in ln for ln in deps), deps)

# 브라우저 본체 쪽 — apt 를 안 쓰지만 여기도 막연히 기다리면 안 됩니다.
body = [ln for ln in script.splitlines()
        if re.search(r"playwright install chromium", ln)]
check("브라우저 본체를 따로 내려받는다", bool(body), script)
check("그 부름에도 timeout 이 붙어 있다",
      bool(body) and all("timeout " in ln for ln in body), body)

check("옛날 방식(--with-deps 한 줄)이 남아 있지 않다", "--with-deps" not in script, script)


# ---------------------------------------------------------------------------
print("\n[3] apt 가 실패해도 넘어가고, 브라우저가 실패하면 멈춘다")

# apt 는 러너에 이미 들어 있는 경우가 대부분이라, 못 깔아도 진행합니다.
# 대신 조용히 넘어가면 안 됩니다 — 경고를 남겨야 합니다.
check("apt 를 못 깔면 경고를 남긴다", "::warning" in script, script)

# 브라우저 본체는 없으면 교보문고를 아예 못 읽습니다. 반드시 실패해야 합니다.
check("브라우저를 못 깔면 작업을 실패시킨다",
      "::error" in script and "exit 1" in script, script)

# 조용히 빈 데이터를 저장하지 않는다는 원칙이 여기서도 지켜집니다.
check("여러 번 다시 시도한다", "for i in" in script, script)


# ---------------------------------------------------------------------------
print("\n[4] 그 명령문이 문법적으로 맞다")

if shutil.which("bash"):
    r = subprocess.run(["bash", "-n"], input=script, text=True, capture_output=True)
    check("bash 문법 통과", r.returncode == 0, r.stderr.strip())
else:
    print("  ⏭️  bash 가 없어서 건너뜁니다")


# ---------------------------------------------------------------------------
print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    raise SystemExit(1)
print("✅ 모두 통과")
