"""
=============================================================================
 AI 일일 리포트 — "어제 순위에서 무슨 일이 있었나" 를 한국어로
=============================================================================

 【무엇을 하나요?】
 매일 수집·매칭이 끝난 뒤, 순위표에서 뽑은 숫자를 AI 에게 주고
 마케팅 담당자가 읽을 만한 요약을 쓰게 합니다.
 결과는 daily_reports 표에 저장되고 사이트 [오늘의 리포트] 에서 보입니다.

 🚨 【이 프로그램은 돈을 씁니다 — 그래서 지키는 것】
  1. config/report.yaml 의 monthly_cap_usd 를 **넘길 수 없습니다.**
     이번 달에 쓴 돈을 먼저 세고, 한도에 닿았으면 부르지 않고 멈춥니다.
  2. 같은 날짜 리포트가 이미 있으면 **다시 부르지 않습니다.**
     (다시 돌려도 돈이 두 번 나가지 않습니다)
  3. 열쇠(ANTHROPIC_API_KEY)가 없으면 아무 일도 안 하고 넘어갑니다.
  4. 한 건마다 쓴 돈을 표에 적습니다. 나중에 확인할 수 있습니다.

 【실행】
 매일 아침 자동으로 돕니다.
 손으로: GitHub → Actions → [AI 일일 리포트]
=============================================================================
"""

from __future__ import annotations

import calendar
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import report_data  # noqa: E402
from common import config as cfg  # noqa: E402

MILLION = 1_000_000
# 화면에 원화를 같이 보여줄 때만 씁니다. 계산·한도는 전부 달러가 기준입니다.
KRW_PER_USD = 1400


def env(name: str) -> str:
    return os.environ.get(name, "").strip()


# -----------------------------------------------------------------------------
#  돈 계산
# -----------------------------------------------------------------------------
def price_of(conf: dict, model: str) -> tuple[float, float]:
    """
    100만 토큰당 (넣는 값, 나오는 값) 달러.

    ⚠️ 모르는 모델이면 **일부러 실패합니다.**
       0원으로 계산해 버리면 한도를 그냥 지나쳐 돈이 계속 나갑니다.
    """
    table = conf.get("pricing") or {}
    row = table.get(model)
    if not row:
        raise SystemExit(
            f"❌ config/report.yaml 의 pricing 에 '{model}' 요금이 없습니다.\n"
            f"   요금을 모르면 얼마 썼는지도 모르고, 한도도 못 지킵니다.\n"
            f"   지금 적혀 있는 모델: {', '.join(sorted(table)) or '(없음)'}"
        )
    return float(row["input"]), float(row["output"])


def cost_of(conf: dict, model: str, tin: int, tout: int) -> float:
    pin, pout = price_of(conf, model)
    return (tin / MILLION) * pin + (tout / MILLION) * pout


def spent_this_month(client, today: str) -> tuple[float, int]:
    """이번 달에 이미 쓴 돈과 건수. (표에 적힌 값을 그대로 더합니다)"""
    first = today[:8] + "01"
    res = (
        client.table("daily_reports")
        .select("cost_usd")
        .gte("report_date", first)
        .lte("report_date", today)
        .execute()
    )
    rows = res.data or []
    return sum(float(r.get("cost_usd") or 0) for r in rows), len(rows)


def won(usd: float) -> str:
    return f"약 {round(usd * KRW_PER_USD):,}원"


# -----------------------------------------------------------------------------
#  AI 에게 부탁하는 말
# -----------------------------------------------------------------------------
SYSTEM = """당신은 한국 출판 시장을 오래 관찰해 온 분석가입니다.
세 서점(교보문고·예스24·알라딘)의 어제자 베스트셀러 순위 자료를 받아,
출판사 마케팅 담당자가 **의사결정에 쓸 수 있는** 리포트를 씁니다.

【🚨 무엇보다 먼저 — 사실에서 벗어나지 마세요】
이것이 다른 모든 지시보다 우선합니다.
- 주어진 자료에 없는 사실을 **절대** 지어내지 마세요. 판매 부수, 광고 집행,
  드라마·영화화, 수상, 언론 보도, 저자 활동, 재고, 매대 위치 — 전부 자료에
  없습니다. "아마 ~때문일 것" 같은 추측을 사실처럼 쓰지 마세요.
- 원인을 단정하지 마세요. 자료로 알 수 있는 것은 **무엇이 일어났는가**이지
  **왜 일어났는가**가 아닙니다. 원인을 말해야 할 때는 반드시
  "자료만으로는 원인을 알 수 없습니다" 를 함께 적으세요.
- 숫자는 자료에 있는 그대로만 쓰세요. 반올림·어림·합산 추정 금지.
- "어제 자료가 없습니다" 라고 적혀 있으면 순위 변화에 대해 아무 말도 마세요.

【전문성은 '추측' 이 아니라 '자료를 겹쳐 읽는 것' 입니다】
아래는 주어진 자료만으로 말할 수 있는 것들입니다. 이런 관점을 쓰세요.
- **서점 간 편차**: 한 책이 알라딘 9위인데 교보 80위라면, 그 자체가 사실이고
  독자층이 갈린다는 신호입니다. 편차가 큰 책을 짚으세요.
- **배본일과 순위의 관계**: 배본 직후(최근 1~3개월)에 오른 책과, 배본 후
  오래 지났는데 다시 오른 책은 성격이 다릅니다. 후자는 역주행입니다.
  배본일이 오래된 책이 상위에 있으면 스테디셀러로 볼 수 있습니다.
- **출판사 포지션**: 한 출판사가 상위권에 몇 종을 올렸는지, 그것이 한 종에
  기댄 것인지 여러 종에 퍼진 것인지.
- **같은 계열의 동시 등장**: 같은 저자·같은 원작·같은 시리즈의 여러 판본이
  동시에 올라 있으면 그것을 묶어서 말하세요.
- **진입 깊이**: 신규 진입이 몇 위로 들어왔는지. 40위권 진입과 5위권 진입은
  뜻이 다릅니다.

【도서를 언급할 때】
반드시 **제목 (출판사, 배본 YYYY-MM)** 형식으로 적으세요.
배본일이 '출간월모름' 이면 **(출판사, 배본일 미상)** 이라고 적으세요.
지어내지 마세요.

【형식】 아래 마크다운 표시만 쓰세요. 표(|)나 링크는 쓰지 마세요.
  ## 소제목
  - 항목
  **굵게**
  그냥 문단

【구성】
## 한 줄 요약
어제 순위에서 가장 중요한 것 한 가지. 두 문장 이내.

## 눈에 띄는 움직임
신규 진입·크게 오른 책·크게 떨어진 책 중 의미 있는 것만 3~6개.
각 항목에 **왜 눈여겨볼 만한지** 한두 줄. 자료로 알 수 있는 범위에서만.
(서점 간 편차, 배본일 대비 시점, 진입 깊이 같은 것을 활용하세요)

## 출판사 흐름
출판사 순위에서 읽을 수 있는 것. 한 종에 기댄 곳과 여러 종이 고른 곳을
구분해서 2~4줄.

## 지켜볼 것
내일 확인해 볼 만한 것 2~3개. 각각 **무엇을 보면 판가름 나는지**까지.

전체 900자 안팎. 인사말과 맺음말은 쓰지 마세요.
확신할 수 없는 것은 쓰지 않는 편이 낫습니다."""


def build_prompt(digest_text: str) -> str:
    return (
        "아래는 자동 수집된 어제자 베스트셀러 순위 자료입니다.\n"
        "이 자료만 보고 리포트를 써 주세요.\n\n"
        "-----\n"
        f"{digest_text}\n"
        "-----\n"
    )


def build_kwargs(conf: dict, prompt: str = "") -> dict:
    """
    AI 에게 보낼 값을 만듭니다. **여기서는 부르지 않습니다.**

    부르는 것과 값을 만드는 것을 나눠 둔 이유는, 시험이 진짜로 부르지 않고도
    "이 값들을 라이브러리가 받아주는가" 를 확인할 수 있게 하기 위해서입니다.
    (아래 check_sdk 참고)
    """
    kwargs: dict = {
        "model": str(conf.get("model", "claude-opus-5")),
        "max_tokens": int(conf.get("max_tokens", 4000)),
        "system": SYSTEM,
        "messages": [{"role": "user", "content": prompt}],
        "output_config": {"effort": str(conf.get("effort", "medium"))},
    }
    # 생각을 끄면 값이 예측 가능해집니다. (config/report.yaml 의 thinking)
    if not conf.get("thinking", False):
        kwargs["thinking"] = {"type": "disabled"}
    return kwargs


def check_sdk(kwargs: dict) -> list[str]:
    """
    지금 깔려 있는 anthropic 라이브러리가 이 값들을 받아주는지 미리 봅니다.
    받아주지 않는 값의 이름을 돌려줍니다 (빈 목록이면 괜찮습니다).

    🚨 【왜 이걸 만들었나 — 2026-08-09 실제로 터짐】
       crawler/requirements.txt 에 anthropic==0.71.0 을 고정해 두고
       코드에서는 output_config(생각 깊이)를 썼습니다. 그 버전에는
       output_config 가 없어서 **실제 운영에서 터졌습니다.**

       시험 30가지가 전부 통과했는데도 터진 이유는, 시험이 **제가 만든
       계산만** 확인하고 **라이브러리가 그 값을 받아주는지는 한 번도
       확인하지 않았기** 때문입니다. 그 구멍을 막는 것이 이 함수입니다.

       이제 tests/test_report.py 가 이걸 부르므로, 버전과 코드가 어긋나면
       AI 를 부르기 전에(=돈을 쓰기 전에) CI 에서 먼저 빨간불이 납니다.
    """
    import inspect

    import anthropic

    try:
        sig = inspect.signature(anthropic.Anthropic(api_key="x").messages.create)
    except Exception:  # noqa: BLE001
        # 서명을 못 읽는 버전이면 확인을 못 합니다. 막지는 않습니다.
        return []

    allowed = set(sig.parameters)
    # **kwargs 를 받는 형태면 무엇이든 통과하므로 확인할 것이 없습니다
    if any(p.kind is inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()):
        return []
    return [k for k in kwargs if k not in allowed]


def ask_claude(conf: dict, prompt: str) -> tuple[str, int, int]:
    """
    AI 를 한 번 부릅니다. (본문, 넣은 토큰, 나온 토큰) 을 돌려줍니다.
    실패하면 무엇이 문제인지 한국어로 알려주고 멈춥니다.
    """
    import anthropic

    kwargs = build_kwargs(conf, prompt)

    # 부르기 전에 확인합니다. 부르는 도중에 터지면 원인이 안 보입니다.
    missing = check_sdk(kwargs)
    if missing:
        raise SystemExit(
            f"❌ 지금 깔린 AI 라이브러리(anthropic {anthropic.__version__})가\n"
            f"   이 설정을 못 알아듣습니다: {', '.join(missing)}\n"
            f"   → 제(클로드)가 고쳐야 하는 문제입니다. 이 메시지를 그대로 알려 주세요.\n"
            f"   (crawler/requirements.txt 의 anthropic 버전을 올리면 됩니다)\n"
            f"   돈은 나가지 않았습니다. AI 를 부르기 전에 멈췄습니다."
        )

    client = anthropic.Anthropic(api_key=env("ANTHROPIC_API_KEY"))

    try:
        res = client.messages.create(**kwargs)
    except anthropic.RateLimitError:
        raise SystemExit(
            "❌ AI 쪽에서 '잠시 너무 많이 불렀다' 고 합니다.\n"
            "   자료는 그대로 있습니다. 내일 다시 돕니다.\n"
            "   급하시면 30분 뒤에 [AI 일일 리포트] 를 손으로 다시 돌려 주세요."
        )
    except anthropic.APIStatusError as exc:
        hint = ""
        if exc.status_code in (401, 403):
            hint = ("\n   → 열쇠(ANTHROPIC_API_KEY)가 틀렸거나 만료됐을 수 있습니다."
                    "\n     docs/ai-report-setup.md 의 '다) 열쇠 다시 만들기' 를 보세요.")
        elif exc.status_code == 400:
            hint = ("\n   → 보낸 요청이 형식에 안 맞습니다. 제(클로드)가 고쳐야 하는 문제입니다."
                    "\n     이 메시지를 그대로 알려 주세요.")
        raise SystemExit(f"❌ AI 호출 실패 ({exc.status_code}): {exc}{hint}")
    except anthropic.APIConnectionError:
        raise SystemExit(
            "❌ AI 쪽에 연결하지 못했습니다 (네트워크).\n"
            "   자료는 그대로 있습니다. 내일 다시 돕니다."
        )

    # ⚠️ 본문을 읽기 전에 반드시 이것부터 봅니다.
    #    거절된 응답에서 본문을 꺼내려 하면 엉뚱한 곳에서 터집니다.
    if getattr(res, "stop_reason", None) == "refusal":
        raise SystemExit(
            "❌ AI 가 이 자료로 글쓰기를 거절했습니다.\n"
            "   순위 자료에 이상한 제목이 섞였을 수 있습니다.\n"
            "   빈 리포트를 저장하지 않고 멈춥니다."
        )

    parts = [b.text for b in res.content if getattr(b, "type", "") == "text"]
    text = "\n".join(parts).strip()
    if not text:
        raise SystemExit(
            "❌ AI 가 빈 글을 돌려줬습니다. 빈 리포트를 저장하지 않고 멈춥니다."
        )

    return text, int(res.usage.input_tokens), int(res.usage.output_tokens)


# -----------------------------------------------------------------------------
def main() -> int:
    conf = cfg.load("report.yaml")

    print("=" * 66)
    print("  AI 일일 리포트")
    print("=" * 66)

    if not conf.get("enabled", True):
        print("\nℹ️ config/report.yaml 에서 꺼져 있습니다.")
        return 0

    if not env("ANTHROPIC_API_KEY"):
        # 아직 안 켜셨을 뿐입니다. 매일 빨간 X 를 띄우면 진짜 고장이 묻힙니다.
        print("\nℹ️ AI 열쇠(ANTHROPIC_API_KEY)가 없어 아무것도 하지 않았습니다.")
        print("   설정 방법: docs/ai-report-setup.md")
        return 0

    from common import db

    client = db.connect()

    day = env("REPORT_DATE") or report_data.latest_date(client)
    if not day:
        print("\n수집된 자료가 없습니다.")
        return 0

    model = str(conf.get("model", "claude-opus-5"))
    price_of(conf, model)          # 요금을 모르면 여기서 바로 멈춥니다

    # ---- 이미 있으면 다시 안 부릅니다 (돈이 두 번 나가지 않게) ----
    force = env("FORCE").lower() == "true"
    have = (
        client.table("daily_reports")
        .select("report_date")
        .eq("report_date", day)
        .execute()
    ).data or []
    if have and not force:
        print(f"\n✅ {day} 리포트가 이미 있습니다. 다시 부르지 않습니다.")
        return 0

    # ---- 이번 달 한도 ----
    cap = float(conf.get("monthly_cap_usd", 3.0))
    spent, n = spent_this_month(client, day)
    print(f"\n이번 달: {n}건 · ${spent:.4f} ({won(spent)}) / 한도 ${cap:.2f} ({won(cap)})")

    if spent >= cap:
        # 🚨 넘길 수 없습니다. "조금만 더" 가 없습니다.
        print(
            f"\n🛑 이번 달 한도(${cap:.2f} · {won(cap)})를 다 썼습니다.\n"
            f"   이번 달 남은 날은 리포트를 만들지 않습니다.\n"
            f"   순위표와 그래프는 그대로 다 보입니다.\n\n"
            f"   한도를 올리시려면 config/report.yaml 의 monthly_cap_usd 를 고치세요.\n"
            f"   값이 싼 AI 로 바꾸려면 model 을 claude-haiku-4-5 로 바꾸세요 (값 1/5)."
        )
        return 0

    if spent >= cap * 0.8:
        print(f"⚠️ 한도의 80% 를 넘었습니다. 이번 달 안에 멈출 수 있습니다.")

    # ---- 자료 뽑기 ----
    print(f"\n기준 날짜: {day}")
    digest = report_data.collect(client, day, conf)
    if not digest["rows"]:
        # 자료가 없는데 AI 를 부르면 돈만 쓰고 지어낸 글이 나옵니다.
        print("\n그 날짜의 종합 순위가 비어 있습니다. AI 를 부르지 않습니다.")
        return 0

    text = report_data.to_text(digest)
    print(f"  종합 {len(digest['rows'])}권 · 신규 {len(digest['new_in'])} · "
          f"상승 {len(digest['up'])} · 하락 {len(digest['down'])}"
          + ("" if digest["has_yesterday"] else "  (어제 자료 없음)"))

    # ---- AI 부르기 ----
    print(f"\n{model} 에게 요약을 부탁합니다...")
    body, tin, tout = ask_claude(conf, build_prompt(text))
    cost = cost_of(conf, model, tin, tout)

    print(f"  넣은 토큰 {tin:,} · 나온 토큰 {tout:,}")
    print(f"  이번 1건 비용: ${cost:.4f} ({won(cost)})")
    print(f"  이번 달 합계: ${spent + cost:.4f} ({won(spent + cost)}) / ${cap:.2f}")

    y, m, d = int(day[:4]), int(day[5:7]), int(day[8:10])
    in_month = calendar.monthrange(y, m)[1]
    days_left = in_month - d
    print(f"  이 속도면 한 달에 ${cost * in_month:.2f} ({won(cost * in_month)}) 정도입니다.")
    if spent + cost + cost * days_left > cap:
        print("  ⚠️ 이 속도면 이번 달 안에 한도에 닿습니다. 닿으면 자동으로 멈춥니다.")

    # ---- 저장 ----
    client.table("daily_reports").upsert(
        {
            "report_date": day,
            "model": model,
            "content_md": body,
            "input_tokens": tin,
            "output_tokens": tout,
            "cost_usd": round(cost, 6),
        },
        on_conflict="report_date",
    ).execute()

    print(f"\n✅ 저장했습니다. 사이트 [오늘의 리포트] 에서 보실 수 있습니다.")

    # ⚠️ 리포트 본문을 여기에 통째로 찍지 않습니다 (2026-08-09 고침).
    #
    #    이 저장소는 **공개**입니다. 실행 기록(Actions 로그)은 누구나
    #    읽을 수 있습니다. 사이트는 회원만 보게 잠가 놓고 정작 같은 글이
    #    로그에 그대로 있으면 잠근 의미가 없습니다.
    #
    #    "잘 나왔는지" 확인은 첫 줄만으로 충분합니다.
    head = next((ln for ln in body.splitlines() if ln.strip()), "")
    print(f"   첫 줄: {head[:40]}{'…' if len(head) > 40 else ''}")
    print(f"   길이: {len(body):,}자")
    print("   전문은 사이트에서 보세요 (로그는 공개라 싣지 않습니다)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
