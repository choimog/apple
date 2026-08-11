"""
=============================================================================
 믿어도 되는지 확인 — 표지 ISBN 과 교보 정가를 서로 대조합니다
=============================================================================

 【왜 만들었나요? — 2026-08-11 탐침 결과】

   ■ 알라딘: 표지 주소에서 ISBN 을 **15,532권 (34.8%)** 찾아냈습니다
   ■ 교보:   정가가 채워진 것 44.4%  ← 0% 가 아니므로 '읽히기는' 합니다

 둘 다 좋은 소식인데, **둘 다 아직 믿으면 안 됩니다.**

 ---------------------------------------------------------------------------
 위험 ①  알라딘 표지 이름이 정말 ISBN 인가?
 ---------------------------------------------------------------------------
   검사식(체크섬)을 통과했다는 것은 '우연이 아닐 가능성이 높다' 는 뜻이지
   '확실하다' 는 뜻이 아닙니다. ISBN10 검사식은 11분의 1 확률로 우연히
   맞습니다. 알라딘 내부 상품번호가 우연히 통과했을 수 있습니다.

   **잘못된 ISBN 하나면 엉뚱한 두 책이 영원히 한 권이 됩니다.**
   ISBN 이 양쪽에 있으면 제목·저자를 볼 것도 없이 확정해 버리기 때문에,
   빈 값보다 훨씬 나쁩니다.

   → 확인 방법: 알라딘 표지에서 뽑은 ISBN 으로 **교보의 같은 ISBN 책**을
     찾아서, 두 책의 제목이 실제로 닮았는지 봅니다.
     교보 ISBN 은 서점이 직접 알려준 값이라 믿을 수 있습니다.
     제목이 안 닮으면 알라딘 표지 이름은 ISBN 이 아닌 것입니다.

 ---------------------------------------------------------------------------
 위험 ②  교보 정가를 제대로 읽고 있는가?  ★ 더 급합니다
 ---------------------------------------------------------------------------
   교보는 실제 화면을 본 적이 없어서, '칸 안의 글자에서 「…원」 을 찾아
   큰 쪽을 정가로 본다' 는 두루뭉술한 방법을 쓰고 있습니다.
   칸 안에 적립금·배송비 같은 다른 금액이 섞여 있으면 **엉뚱한 값을
   정가라고 저장합니다.**

   그런데 지금 매칭 규칙은 **정가가 다르면 무조건 다른 책**으로 갈라냅니다
   (config/matching.yaml 의 price_hard). 교보 정가가 틀리면
   **멀쩡한 짝이 조용히 갈라집니다.**

   → 확인 방법: ISBN 이 같은 교보·알라딘 짝의 정가를 맞대 봅니다.
     도서정가제상 정가는 출판사가 정한 하나의 값이라 3사가 같아야 합니다.

   ⚠️ 이때 **이미 묶여 있는 무리(book_id)를 쓰면 안 됩니다.**
      지금 매칭이 '정가가 다르면 갈라낸다' 로 묶은 결과라서, 그걸로 재면
      당연히 100% 일치가 나옵니다. 스스로 채점한 답안지입니다.
      그래서 매칭 결과와 상관없는 **ISBN** 으로만 짝을 짓습니다.

 【안전한가요?】
 네. 이미 저장된 자료만 읽습니다. 서점에 요청을 한 건도 보내지 않고,
 아무것도 저장·수정하지 않습니다. 세어 보기만 합니다.

 실행: python crawler/probe_trust.py
       (GitHub → Actions → [정밀 탐침 (probe)] 에서 함께 돕니다)
=============================================================================
"""

from __future__ import annotations

import re
import sys
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from probe_isbn import find_isbn  # noqa: E402

STORE_NAME = {1: "교보문고", 2: "예스24", 3: "알라딘"}
SHOW = 6

# 제목이 이만큼 닮으면 '같은 책이 맞다' 고 봅니다.
TITLE_OK = 0.60


def sim(a: str | None, b: str | None) -> float:
    """
    두 제목이 얼마나 닮았는지 0~1 로.

    【2026-08-11 저녁 — 처음 만든 것이 헛것을 잡았습니다】
    '안 맞은 예시' 라고 내놓은 것들이 사실은 **같은 책**이었습니다.

        알라딘: 체스 챔피언            교보: 체스 챔피언:이기는 체스 게임의 법칙
        알라딘: 소설 보다 : 여름 2026  교보: 소설 보다: 여름 2026
        알라딘: 사피엔스 : 그래픽 …    교보: 사피엔스: 그래픽 …

    서점마다 부제를 떼는 자리가 달라서 norm_title 이 갈라진 것뿐인데,
    글자를 통째로 견주니 0.42 · 0.50 같은 낮은 점수가 나왔습니다.
    그 숫자를 그대로 믿었으면 **멀쩡한 ISBN 을 못 쓴다고 결론**낼 뻔했습니다.

    그래서 두 가지를 함께 봅니다.
      · 한쪽이 다른 쪽의 **앞부분**이면 같은 책으로 봅니다 (부제 차이)
      · 그 밖에는 글자 견주기
    """
    if not a or not b:
        return 0.0
    x, y = (a, b) if len(a) <= len(b) else (b, a)
    # 부제만 더 붙은 경우. 너무 짧으면 우연히 겹치므로 4글자 이상만.
    if len(x) >= 4 and y.startswith(x):
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


def plain(text: str | None) -> str:
    """제목에서 띄어쓰기와 기호를 걷어냅니다. '체스 챔피언:이기는…' 비교용."""
    return re.sub(r"[^0-9A-Za-z가-힣]+", "", text or "")


def isbn_of(row: dict) -> str | None:
    """
    이 책의 ISBN. 서점이 알려준 값이 있으면 그것을,
    없으면 표지 주소에서 찾아냅니다.
    """
    got = (row.get("isbn13") or "").strip()
    if len(got) == 13 and got.isdigit():
        return got
    hit = find_isbn((row.get("cover_url") or "").strip())
    return hit[0] if hit else None


# ---------------------------------------------------------------------------
#  ① 알라딘 표지 ISBN 이 진짜인가 — 교보와 맞대 봅니다
# ---------------------------------------------------------------------------
def check_cover_isbn(rows: list[dict]) -> None:
    print("=" * 66)
    print("  ① 알라딘 표지 주소의 ISBN 이 진짜인가")
    print("=" * 66)
    print("  교보 ISBN 은 서점이 직접 알려준 값이라 믿을 수 있습니다.")
    print("  같은 ISBN 인 교보 책과 제목이 닮았는지 봅니다.\n")

    # 교보: 서점이 알려준 ISBN 만 (표지에서 추측한 것은 안 씁니다)
    kyobo: dict[str, dict] = {}
    for r in rows:
        if (r.get("store_id") or 0) != 1:
            continue
        got = (r.get("isbn13") or "").strip()
        if len(got) == 13 and got.isdigit():
            kyobo.setdefault(got, r)

    print(f"  교보 ISBN {len(kyobo):,}개를 기준으로 삼습니다.\n")

    for sid in (3, 2):
        name = STORE_NAME[sid]
        found = matched = agree = 0
        bad: list[str] = []
        good: list[str] = []

        for r in rows:
            if (r.get("store_id") or 0) != sid:
                continue
            # 표지에서 찾아낸 것만 봅니다 (서점이 준 값은 검증할 필요가 없음)
            if (r.get("isbn13") or "").strip():
                continue
            hit = find_isbn((r.get("cover_url") or "").strip())
            if not hit:
                continue
            found += 1
            other = kyobo.get(hit[0])
            if other is None:
                continue          # 교보에 없는 책. 맞는지 틀린지 알 수 없음
            matched += 1
            # 정리한 제목(norm)과 서점이 적은 그대로(raw) 를 둘 다 보고
            # **더 닮은 쪽**을 씁니다. 서점마다 부제를 떼는 자리가 달라서
            # 한쪽만 보면 같은 책을 다르다고 하게 됩니다.
            s = max(
                sim(r.get("norm_title"), other.get("norm_title")),
                sim(plain(r.get("raw_title")), plain(other.get("raw_title"))),
            )
            line = (f"      {hit[0]}  닮은 정도 {s:.2f}\n"
                    f"        {name}: {r.get('raw_title')}\n"
                    f"        교보  : {other.get('raw_title')}")
            if s >= TITLE_OK:
                agree += 1
                if len(good) < SHOW:
                    good.append(line)
            elif len(bad) < SHOW:
                bad.append(line)

        print("-" * 66)
        print(f"■ {name}")
        print(f"   표지에서 ISBN 을 찾아낸 것       {found:,}권")
        print(f"   그중 교보에도 같은 ISBN 이 있는 것 {matched:,}권")
        if matched == 0:
            print("   → 맞대 볼 짝이 없어 **판정할 수 없습니다.**")
            print("      (교보에 없는 책들이라 맞는지 틀린지 알 수 없습니다)")
            continue
        pct = 100.0 * agree / matched
        print(f"   그중 제목이 실제로 닮은 것        **{agree:,}권 ({pct:.1f}%)**")
        if pct >= 95:
            print("   ✅ 진짜 ISBN 입니다. 매칭에 써도 됩니다.")
        elif pct >= 80:
            print("   ⚠️ 대체로 맞지만 틀린 것이 섞여 있습니다.")
            print("      ISBN 만으로 확정하면 안 되고, 제목도 함께 봐야 합니다.")
        else:
            print("   ❌ ISBN 이 아닙니다. **매칭에 쓰면 안 됩니다.**")
        if good:
            print("   맞은 예시:")
            for g in good[:3]:
                print(g)
        if bad:
            print("   🚨 안 맞은 예시:")
            for b in bad:
                print(b)


# ---------------------------------------------------------------------------
#  ② 교보 정가를 제대로 읽고 있는가 — ISBN 이 같은 짝끼리 맞대 봅니다
# ---------------------------------------------------------------------------
def check_prices(rows: list[dict]) -> None:
    print("\n" + "=" * 66)
    print("  ② 정가를 제대로 읽고 있는가")
    print("=" * 66)
    print("  도서정가제상 정가는 출판사가 정한 하나의 값이라 3사가 같아야")
    print("  합니다. 다르면 둘 중 하나를 잘못 읽고 있는 것입니다.")
    print("  ⚠️ 매칭이 묶어 놓은 무리는 안 씁니다. '정가가 다르면 갈라낸다'")
    print("     로 묶은 결과라 100% 일치가 나오는 것이 당연하기 때문입니다.\n")

    # ISBN 별로 서점마다 정가를 모읍니다
    by_isbn: dict[str, dict[int, dict]] = defaultdict(dict)
    for r in rows:
        if not r.get("list_price"):
            continue
        got = isbn_of(r)
        if got:
            by_isbn[got].setdefault(r.get("store_id") or 0, r)

    pairs = [(1, 3), (1, 2), (2, 3)]
    stats: dict[tuple[int, int], list[int]] = {p: [0, 0] for p in pairs}
    examples: dict[tuple[int, int], list[str]] = defaultdict(list)

    for got, per_store in by_isbn.items():
        for a, b in pairs:
            ra, rb = per_store.get(a), per_store.get(b)
            if not ra or not rb:
                continue
            stats[(a, b)][0] += 1
            if ra["list_price"] == rb["list_price"]:
                stats[(a, b)][1] += 1
            elif len(examples[(a, b)]) < SHOW:
                examples[(a, b)].append(
                    f"      {got}\n"
                    f"        {STORE_NAME[a]}: {ra['list_price']:,}원  "
                    f"{ra.get('raw_title')}\n"
                    f"        {STORE_NAME[b]}: {rb['list_price']:,}원  "
                    f"{rb.get('raw_title')}"
                )

    any_pair = False
    for a, b in pairs:
        n, ok = stats[(a, b)]
        print("-" * 66)
        print(f"■ {STORE_NAME[a]} ↔ {STORE_NAME[b]}")
        if n == 0:
            print("   맞대 볼 짝이 없습니다 (양쪽 다 ISBN 과 정가가 있어야 함)")
            continue
        any_pair = True
        pct = 100.0 * ok / n
        mark = "✅" if pct >= 95 else ("⚠️" if pct >= 80 else "❌")
        print(f"   {mark} {n:,}쌍 중 {ok:,}쌍 일치 (**{pct:.1f}%**)")
        if examples[(a, b)]:
            print("   안 맞은 예시:")
            for e in examples[(a, b)]:
                print(e)

    print("-" * 66)
    if not any_pair:
        print("\n  ⚠️ 맞대 볼 짝이 하나도 없어 **판정할 수 없습니다.**")
        print("     예스24 는 ISBN 이 없고, 알라딘은 34.8% 만 있습니다.")
        print("     수집을 한두 번 더 돌린 뒤 다시 보셔야 합니다.")
        return

    print("\n【읽는 법】")
    print("  · 교보가 낀 짝만 일치율이 낮으면 → **교보 가격 읽기가 틀린 것**")
    print("    입니다. 지금 매칭은 '정가가 다르면 다른 책' 으로 갈라내므로,")
    print("    멀쩡한 짝이 조용히 갈라지고 있다는 뜻입니다. 바로 고쳐야 합니다.")
    print("  · 세 짝 다 높으면 → 정가를 믿고 매칭에 써도 됩니다.")
    print("  · 세 짝 다 낮으면 → 정가가 다른 건 진짜 다른 판형일 수 있습니다.")
    print("    (같은 ISBN 인데 정가가 다르면 그건 서점 표기 오류입니다)")


def main() -> int:
    from common import db  # 여기서 불러야 시험이 DB 없이 돕니다

    client = db.connect()
    rows = db.fetch_all_store_books(client)
    print(f"서점별 도서 {len(rows):,}권을 읽었습니다.\n")

    check_cover_isbn(rows)
    check_prices(rows)

    print("\n※ 이 프로그램은 아무것도 저장하지 않습니다. 세어 보기만 합니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
