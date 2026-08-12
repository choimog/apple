"""
🚨 리포트가 '지난 7일치'를 제대로 겹쳐 읽는지 봅니다.

【2026-08-12 대표님 요청】
    "리포트의 경우, 지금의 규정에서 이전 7일치의 리포트까지 보고,
     작성했으면 좋겠어.
     리포트마다 매번 똑같은 말을 할 수도 있기 때문에 그것을 방지하려는
     목적도 있고, 이전에 있었던 리포트의 가설이 맞았는지 확인해볼 수도
     있고, 이전에 있었던 리포트에서 주의 깊게 보라고 했던 그 결과가
     어땠는지 알 수 있고, 뭐 그런 식의 장점이 있지 않을까?
     그렇다고 해서 별 이슈도 없는데, 꼭 지난 리포트와 연결지어야 할
     필요는 없는 거고."

여기서 조심할 것이 셋입니다.

  ① 🚨 **지난 글을 오늘 자료로 착각하면 안 됩니다.**
     지난 리포트에는 며칠 전 순위·숫자가 적혀 있습니다. 그것을 오늘
     것처럼 옮겨 적으면 **거짓말이 됩니다.** 대표님이 처음부터
     "가짜 데이터로 된 것처럼 보이게 하지 마" 라고 하신 그 지점입니다.

  ② **억지로 엮으면 안 됩니다.** 대표님이 직접 못박으셨습니다.

  ③ 🚨 **돈이 더 듭니다.** 넣는 글이 길어진 만큼 값이 오릅니다.
     한 달 한도가 3달러뿐이라 조용히 늘어나면 월말에 리포트가 멈춥니다.

실행: python tests/test_report_history.py
※ 인터넷도 DB 도 필요 없습니다.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

_fake = types.ModuleType("supabase")
_fake.Client = object
_fake.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _fake)

import report_data                      # noqa: E402
import run_report                       # noqa: E402
from common import config as cfg        # noqa: E402

CONF = cfg.load("report.yaml")

failures: list[str] = []


def check(name: str, ok: bool, got=None) -> None:
    if ok:
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name}" + (f"\n       나온 값: {got!r}" if got is not None else ""))
        failures.append(name)


REPORTS = [
    {"report_date": "2026-08-09", "content_md": "## 한 줄 요약\n아홉째 날.\n## 지켜볼 것\n- 『가』가 내일도 5위 안인지"},
    {"report_date": "2026-08-11", "content_md": "## 한 줄 요약\n열한째 날.\n"},
    {"report_date": "2026-08-10", "content_md": "## 한 줄 요약\n열째 날.\n"},
]

print("\n[1] 설정")
check("지난 리포트를 보는 날수가 7일", CONF.get("history_days") == 7,
      CONF.get("history_days"))
check("한 편을 몇 자까지 넣을지 정해져 있다",
      isinstance(CONF.get("history_max_chars"), int), CONF.get("history_max_chars"))

print("\n[2] 지난 리포트를 글로 만들기")
t = report_data.history_text(REPORTS)
check("오래된 것부터 차례로 놓는다",
      t.index("2026-08-09") < t.index("2026-08-10") < t.index("2026-08-11"))
check("날짜를 함께 적는다 (며칠 전 이야기인지 알아야 합니다)",
      t.count("리포트 ─────") == 3, t.count("리포트 ─────"))
check("아무것도 없으면 빈 글", report_data.history_text([]) == "")

print("\n[3] 🚨 긴 리포트는 자르되, 잘랐다고 적는다")
long_one = [{"report_date": "2026-08-01", "content_md": "가" * 5000}]
cut = report_data.history_text(long_one, 1500)
check("길이를 지킨다", len(cut) < 1800, len(cut))
check("🚨 자른 것을 숨기지 않는다", "줄임" in cut,
      "조용히 자르면 AI 가 '뒤에 아무 말도 없었다' 고 믿습니다")

print("\n[4] 🚨 오늘 자료가 언제나 먼저입니다")
p = run_report.build_prompt("오늘자료입니다", t)
check("오늘 자료가 지난 리포트보다 앞에 온다",
      p.index("오늘자료입니다") < p.index("2026-08-09"),
      "지난 글이 앞에 오면 거기에 끌려가 오늘 없는 책 이야기를 씁니다")
check("🚨 지난 글은 '자료가 아니다' 라고 못박는다", "이건 자료가 아닙니다" in p)
check("🚨 지난 숫자를 오늘 것으로 쓰지 말라고 한다",
      "오늘 것으로 쓰지 마세요" in p or "오늘 것으로 쓰지" in p)
check("참고용이라고 분명히 적는다", "참고용" in p)

print("\n[5] 지난 리포트가 없으면 예전 그대로")
p0 = run_report.build_prompt("오늘자료입니다", "")
check("붙이는 글이 없다", "=====" not in p0)
check("공백만 있어도 안 붙인다", "=====" not in run_report.build_prompt("x", "   \n "))

print("\n[6] AI 에게 주는 지시")
S = run_report.SYSTEM
check("같은 말 반복을 막는다", "같은 말을 또 하지 마세요" in S)
check("지난 「지켜볼 것」의 답을 하라고 한다", "지켜볼 것" in S and "답을 하세요" in S)
check("🚨 틀렸으면 틀렸다고 적으라고 한다", "틀렸으면 틀렸다고 적으세요" in S,
      "맞은 것만 골라 적으면 리포트가 자기 편을 듭니다")
check("🚨 억지로 엮지 말라고 한다 (대표님이 못박으신 부분)",
      "억지로 엮지 마세요" in S)
check("쓸 말 없으면 소제목째로 빼라고 한다",
      "소제목을 아예 쓰지 마세요" in S or "소제목째로" in S)
check("🚨 지난 글에만 있는 책을 오늘 것처럼 쓰지 말라고 한다",
      "오늘도 있는 것처럼 쓰면" in S)
check("대부분의 날은 이 항목이 없는 것이 정상이라고 알려준다",
      "없는 것이 정상" in S)

print("\n[7] 🚨 돈 — 조용히 늘어나면 안 됩니다")
RUN = (ROOT / "crawler" / "run_report.py").read_text(encoding="utf-8")
check("늘어나는 값을 화면에 적는다", "이것 때문에 늘어나는 값" in RUN)
check("🚨 한도에 부담이면 날수를 줄인다", "편을 뺐습니다" in RUN,
      "안 줄이면 월말에 리포트가 통째로 멈춥니다")
check("줄였다고 반드시 알린다", "⚠️ 이대로면 이번 달 한도" in RUN)
check("줄일 때도 최소 2편은 남긴다", "max(2, len(history)" in RUN)
check("한도 자체는 그대로 지킨다 (넘길 수 없음)", "spent >= cap" in RUN)

# 어림값이 실제보다 적게 나오면 한도를 넘깁니다.
check("토큰 어림은 넉넉하게 잡는다 (한글 한 자 = 토큰 하나)",
      run_report.est_tokens("가나다라마") == 5,
      run_report.est_tokens("가나다라마"))

print("\n[8] 0 으로 두면 예전 방식 그대로")
check("0 이면 읽지 않는다", report_data.recent_reports(None, "2026-08-12", 0) == [])

print()
if failures:
    print(f"❌ {len(failures)}개 실패")
    for f in failures:
        print(f"   · {f}")
    raise SystemExit(1)
print("✅ 모두 통과")
