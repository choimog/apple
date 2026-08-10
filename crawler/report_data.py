"""
=============================================================================
 AI 리포트에 넣을 '자료 요약' 만들기
=============================================================================

 이 파일은 **AI 를 부르지 않습니다.** 순위표에서 숫자만 뽑아 정리합니다.
 그래야 AI 없이도 시험할 수 있고, 잘못된 숫자를 AI 탓으로 돌리지 않습니다.

 【지키는 것】
  · 없는 값을 지어내지 않습니다. 어제 자료가 없으면 '변화 없음' 이 아니라
    **'어제 자료 없음'** 이라고 적습니다.
  · 순위 변화는 '어제 몇 위였나' 를 실제로 찾아서 계산합니다.
=============================================================================
"""

from __future__ import annotations

from datetime import date, timedelta

STORE_NAME = {1: "교보문고", 2: "예스24", 3: "알라딘"}


def _combined(client, day: str, limit: int, min_stores: int, depth: int) -> list[dict]:
    res = client.rpc(
        "combined_best",
        {
            "p_date": day,
            "p_period": "daily",
            "p_unified": "all",
            "p_min_stores": min_stores,
            "p_depth": depth,
            "p_limit": limit,
        },
    ).execute()
    return res.data or []


def _publishers(client, day: str, limit: int, depth: int) -> list[dict]:
    res = client.rpc(
        "publisher_ranking",
        {
            "p_date": day,
            "p_period": "daily",
            "p_unified": "all",
            "p_depth": depth,
            "p_min_stores": 1,
            "p_limit": limit,
        },
    ).execute()
    return res.data or []


def latest_date(client) -> str | None:
    res = (
        client.table("rankings")
        .select("snapshot_date")
        .order("snapshot_date", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0]["snapshot_date"] if rows else None


def pub_ym_map(client, book_ids: list[int]) -> dict[int, str]:
    """
    도서별 출간월(배본일).

    【2026-08-09 대표님 요청】
    "리포트에서 도서명을 밝힐 때 배본일도 밝혔으면 좋겠고"

    종합 순위(combined_best)에는 출간월이 없어서 따로 읽어 옵니다.
    서점마다 조금씩 다르게 적을 수 있는데, 2026-08-09 부터 출간월이 다르면
    아예 다른 책으로 갈라지므로 한 책 안에서는 같은 값입니다.
    **없으면 지어내지 않고 비워 둡니다.**
    """
    out: dict[int, str] = {}
    for i in range(0, len(book_ids), 200):
        chunk = book_ids[i : i + 200]
        try:
            res = (
                client.table("store_books")
                .select("book_id,pub_ym")
                .in_("book_id", chunk)
                .not_.is_("pub_ym", "null")
                .execute()
            )
        except Exception:  # noqa: BLE001
            continue
        for r in res.data or []:
            bid = r.get("book_id")
            ym = r.get("pub_ym")
            if bid is not None and ym and bid not in out:
                out[int(bid)] = str(ym)
    return out


def collect(client, day: str, cfg: dict) -> dict:
    """
    하루치 요약을 만듭니다. AI 에게 넘길 재료입니다.
    """
    top = int(cfg.get("top", 40))
    depth = int(cfg.get("compare_depth", 300))
    min_stores = int(cfg.get("min_stores", 2))
    big = int(cfg.get("big_move", 20))
    n_pub = int(cfg.get("publishers", 12))

    prev = (date.fromisoformat(day) - timedelta(days=1)).isoformat()

    today = _combined(client, day, top, min_stores, depth)
    # 어제는 깊게 봅니다. 얕게 보면 "어제 250위였던 책" 이 전부
    # '신규 진입' 으로 잘못 잡힙니다.
    yesterday = _combined(client, prev, min(depth, 500), min_stores, depth)

    prev_rank = {int(r["book_id"]): i for i, r in enumerate(yesterday, 1)}
    have_yesterday = bool(yesterday)

    ym_of = pub_ym_map(client, [int(r["book_id"]) for r in today])

    rows = []
    for i, r in enumerate(today, 1):
        bid = int(r["book_id"])
        was = prev_rank.get(bid)
        ranks = r.get("ranks") or {}
        rows.append({
            "rank": i,
            "title": r.get("title") or "",
            "author": r.get("author") or "",
            "publisher": r.get("publisher") or "",
            # 없으면 빈 값 그대로 둡니다 (AI 에게 "모른다" 를 알려야 합니다)
            "pub_ym": ym_of.get(bid, ""),
            "stores": int(r.get("store_count") or 0),
            "store_ranks": {
                STORE_NAME.get(int(k), str(k)): int(v) for k, v in sorted(ranks.items())
            },
            # 어제 자료 자체가 없으면 None 이 아니라 '모름' 입니다.
            # None 을 '신규 진입' 으로 읽으면 첫날 전체가 신규가 됩니다.
            "prev_rank": was,
            "change": (was - i) if was is not None else None,
        })

    if not have_yesterday:
        new_in, up, down = [], [], []
    else:
        new_in = [r for r in rows if r["prev_rank"] is None]
        up = sorted(
            [r for r in rows if r["change"] is not None and r["change"] >= big],
            key=lambda r: -r["change"],
        )
        down = sorted(
            [r for r in rows if r["change"] is not None and r["change"] <= -big],
            key=lambda r: r["change"],
        )

    pubs_today = _publishers(client, day, n_pub, depth)
    pubs_prev = {p["name"]: i for i, p in enumerate(_publishers(client, prev, 50, depth), 1)}
    pubs = [
        {
            "rank": i,
            "name": p["name"],
            "books": int(p.get("books") or 0),
            "prev_rank": pubs_prev.get(p["name"]),
        }
        for i, p in enumerate(pubs_today, 1)
    ]

    return {
        "date": day,
        "prev_date": prev,
        "has_yesterday": have_yesterday,
        "big_move": big,
        "rows": rows,
        "new_in": new_in,
        "up": up,
        "down": down,
        "publishers": pubs,
    }


def to_text(d: dict) -> str:
    """
    AI 에게 넘길 글. 표를 그대로 붙이지 않고 필요한 것만 줄글로 만듭니다.
    (넘기는 글이 길수록 돈이 더 듭니다)
    """
    L: list[str] = []
    L.append(f"[기준일] {d['date']}  (비교 대상: {d['prev_date']})")
    if not d["has_yesterday"]:
        L.append(
            "⚠️ 어제 자료가 없습니다. 순위 변화·신규 진입은 알 수 없습니다. "
            "변화에 대해 아무 말도 하지 마세요."
        )
    L.append("")

    L.append(f"[종합 순위 TOP{len(d['rows'])}] (2개 서점 이상에 오른 책)")
    for r in d["rows"]:
        where = " ".join(f"{k}{v}위" for k, v in r["store_ranks"].items())
        if not d["has_yesterday"]:
            mv = "어제모름"
        elif r["prev_rank"] is None:
            mv = "신규진입"
        elif r["change"] == 0:
            mv = "변화없음"
        else:
            mv = f"{r['change']:+d}"
        ym = r.get("pub_ym") or "출간월모름"
        L.append(
            f"{r['rank']:>3}. {r['title']} / {r['author']} / {r['publisher']} "
            f"/ 배본 {ym} [{mv}] ({where})"
        )
    L.append("")

    if d["has_yesterday"]:
        big = d["big_move"]
        def line(r, arrow: bool) -> str:
            ym = r.get("pub_ym") or "출간월모름"
            head = f"{r['prev_rank']}위→{r['rank']}위" if arrow else f"{r['rank']}위"
            return f"  {head} {r['title']} / {r['publisher']} / 배본 {ym}"

        L.append(f"[신규 진입] {len(d['new_in'])}권")
        for r in d["new_in"]:
            L.append(line(r, False))
        L.append("")
        L.append(f"[{big}계단 이상 오름] {len(d['up'])}권")
        for r in d["up"]:
            L.append(line(r, True))
        L.append("")
        L.append(f"[{big}계단 이상 내림] {len(d['down'])}권")
        for r in d["down"]:
            L.append(line(r, True))
        L.append("")

    L.append("[출판사 순위]")
    for p in d["publishers"]:
        was = f" (어제 {p['prev_rank']}위)" if p["prev_rank"] else " (어제 순위권 밖)"
        if not d["has_yesterday"]:
            was = ""
        L.append(f"{p['rank']:>3}. {p['name']} — 진입 {p['books']}종{was}")

    return "\n".join(L)
