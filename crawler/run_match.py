"""
=============================================================================
 같은 책 묶기(매칭) — 실행 파일
=============================================================================

 세 서점이 따로 가지고 있는 도서를 "이건 같은 책" 으로 묶어서
 하나의 도서 마스터(books)로 만듭니다.

 【왜 필요한가요?】
 서점마다 같은 책을 다르게 적어 놓기 때문에, 묶지 않으면
 "이 책이 3사에서 각각 몇 위인지" 를 한 화면에서 볼 수 없습니다.

 【규칙】
 - 사람이 내린 결정이 최우선 (자동 로직이 절대 못 뒤집음)
 - 규칙 설명: docs/matching-rules.md
 - 숫자 설정:  config/matching.yaml

 【실행】
 GitHub → Actions → [도서 매칭] → Run workflow
   dry_run : true 로 두면 DB 에 저장하지 않고 결과만 보여줍니다
=============================================================================
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import config as cfg  # noqa: E402
from common import db  # noqa: E402
from common.match import Candidate, compare, compare_with_isbn, similarity  # noqa: E402

# 대표 정보를 고를 때의 서점 우선순위 (표지 우선순위와 동일)
#   알라딘 → 예스24 → 교보
STORE_PRIORITY = {3: 0, 2: 1, 1: 2}
STORE_CODE = {1: "kyobo", 2: "yes24", 3: "aladin"}


# -----------------------------------------------------------------------------
#  같은 무리 찾기 (Union-Find)
# -----------------------------------------------------------------------------
class Groups:
    """
    '이것과 저것은 같은 책' 을 계속 이어붙여서 무리를 만드는 도구입니다.
    A=B, B=C 를 알려주면 A·B·C 를 한 무리로 만들어 줍니다.
    """

    def __init__(self) -> None:
        self.parent: dict[int, int] = {}

    def find(self, x: int) -> int:
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)

    def clusters(self) -> dict[int, list[int]]:
        out: dict[int, list[int]] = defaultdict(list)
        for x in self.parent:
            out[self.find(x)].append(x)
        return out


# -----------------------------------------------------------------------------
#  비교 후보 좁히기 (블로킹)
# -----------------------------------------------------------------------------
def build_blocks(cands: list[Candidate], mcfg: dict) -> list[list[Candidate]]:
    """
    8,000권을 전부 비교하면 3천만 번이 넘습니다.
    그래서 '핵심 제목 앞 N글자가 같은 책들' 끼리만 묶어서 비교합니다.
    저자가 같은 책들도 한 번 더 묶습니다 (제목이 다르게 적힌 경우 대비).
    """
    b = mcfg["blocking"]
    n = b["title_prefix_len"]
    limit = b["max_group_size"]

    by_key: dict[str, list[Candidate]] = defaultdict(list)
    for c in cands:
        if c.norm_title:
            by_key[f"t:{c.norm_title[:n]}"].append(c)
        if b.get("also_block_by_author") and c.norm_author:
            by_key[f"a:{c.norm_author}"].append(c)

    blocks = []
    skipped = 0
    for key, group in by_key.items():
        if len(group) < 2:
            continue
        if len(group) > limit:
            skipped += 1
            print(f"  ⚠️ 너무 큰 묶음이라 건너뜀: {key} ({len(group)}권)")
            continue
        blocks.append(group)
    if skipped:
        print(f"  ⚠️ 건너뛴 묶음 {skipped}개 — config/matching.yaml 의 "
              f"blocking.max_group_size 를 늘리면 포함됩니다.")
    return blocks


# -----------------------------------------------------------------------------
#  대표 정보 고르기
# -----------------------------------------------------------------------------
def pick_representative(rows: list[dict]) -> dict:
    """
    한 무리(같은 책)에서 화면에 보여줄 대표 정보를 고릅니다.

    기준: 알라딘 → 예스24 → 교보 순으로 우선.
          우선순위가 높은 서점에 값이 없으면 다음 서점 값으로 채웁니다.
    """
    ordered = sorted(rows, key=lambda r: STORE_PRIORITY.get(r["store_id"], 9))

    def pick(field: str):
        for r in ordered:
            if r.get(field):
                return r[field]
        return None

    cover_row = next((r for r in ordered if r.get("cover_url")), None)

    return {
        "title": pick("raw_title"),
        "author": pick("raw_author"),
        "publisher": pick("raw_publisher"),
        "pub_ym": pick("pub_ym"),
        "isbn13": pick("isbn13"),   # 현재는 교보만 제공 (표지 주소에서 추출)
        "cover_url": cover_row["cover_url"] if cover_row else None,
        "cover_source": STORE_CODE.get(cover_row["store_id"]) if cover_row else None,
    }


# -----------------------------------------------------------------------------
#  사람이 '다른 책' 이라고 한 짝을 갈라내기
# -----------------------------------------------------------------------------
def split_by_manual(
    cluster: list[int],
    edges: list[tuple[float, int, int]],
    forbidden: set[tuple[int, int]],
    max_members: int = 60,
) -> list[list[int]]:
    """
    사람이 '다른 책' 이라고 한 짝이 한 무리에 들어 있으면 갈라냅니다.

    【왜 필요한가요? — 2026-08-09 검토 화면을 만들면서】
    검토 화면에서 [다른 책입니다] 를 누르면 그 짝은 더 이상 직접 이어지지
    않습니다. 그런데 무리는 이어진 것을 계속 따라가므로, 다른 책을 다리
    삼아 도로 한 무리가 될 수 있습니다.

        A ─ C ─ B        (A-B 는 '다른 책' 이라고 눌렀는데도 한 무리)

    예전 코드는 이걸 **경고만** 하고 넘어갔습니다. 그러면 대표님은 버튼을
    눌렀고 '저장했습니다' 도 봤는데 화면은 그대로입니다.
    버튼이 거짓말을 하는 셈이라 실제로 갈라내도록 했습니다.

    【어떻게 갈라내나요?】
    무리를 지우고 처음부터 다시 잇습니다. 이을 때 **점수가 높은 짝부터**
    이어 붙이되, 이으면 '다른 책' 인 짝이 한 무리가 되어 버리는 연결은
    건너뜁니다. 즉 확신이 약한 연결이 먼저 끊깁니다.

    ※ 사람이 [같은 책] 이라고 누른 짝은 점수를 무한대로 줍니다.
      사람 결정이 기계 점수보다 항상 먼저입니다.
    """
    if len(cluster) < 2 or not forbidden:
        return [cluster]

    inside = set(cluster)
    mine = {(a, b) for a, b in forbidden if a in inside and b in inside}
    if not mine:
        return [cluster]

    # 너무 큰 무리는 건드리지 않습니다. 아래 비교가 무리 크기의 제곱으로
    # 늘어나서, 수백 권짜리 무리에서 갑자기 느려질 수 있습니다.
    # 조용히 느려지느니 손대지 않고 알리는 편이 낫습니다.
    if len(cluster) > max_members:
        return [cluster]

    g = Groups()
    for i in cluster:
        g.find(i)
    members: dict[int, set[int]] = {i: {i} for i in cluster}

    for _score, a, b in sorted(edges, key=lambda e: -e[0]):
        if a not in inside or b not in inside:
            continue
        ra, rb = g.find(a), g.find(b)
        if ra == rb:
            continue
        ma, mb = members[ra], members[rb]
        # 이 둘을 이으면 '다른 책' 인 짝이 한 무리가 되나?
        if any((x, y) in mine or (y, x) in mine for x in ma for y in mb):
            continue
        g.union(a, b)
        root = g.find(a)
        merged = ma | mb
        members[root] = merged
        for dead in (ra, rb):
            if dead != root:
                members.pop(dead, None)

    return [sorted(v) for v in g.clusters().values()]


# -----------------------------------------------------------------------------
#  무리 안에 출판사가 섞였으면 갈라내기 (마지막 안전장치)
# -----------------------------------------------------------------------------
def split_by_publisher(
    cluster: list[int],
    by_id: dict[int, dict],
    pair_score: dict[tuple[int, int], float],
    floor: float,
) -> list[list[int]]:
    """
    한 무리 안에 서로 다른 출판사가 섞여 있으면 출판사별로 쪼갭니다.

    【왜 또 필요한가요? — 2026-08-08】
    "출판사가 다르면 안 묶는다" 는 규칙은 두 권씩 비교할 때 적용됩니다.
    그런데 무리를 만들 때는 이어진 것을 계속 따라갑니다. 그래서 이런 일이
    생길 수 있습니다.

        민음사 싯다르타 ─ (출판사 안 적힌 싯다르타) ─ 문학동네 싯다르타

    가운데 책은 출판사를 모르니 양쪽 다 통과합니다. 결과적으로 민음사와
    문학동네가 한 권이 됩니다. 규칙은 지켰는데 결과는 틀립니다.
    그래서 무리를 다 만든 뒤 마지막으로 한 번 더 확인해서 갈라냅니다.

    출판사를 모르는 책은, 점수가 가장 높았던 상대 쪽에 붙입니다.

    【빠르기 — 2026-08-08】
    처음에는 무리 안의 책을 두 권씩 전부 비교했습니다. 한 무리가 수백 권이
    되면 느린 이름 비교가 수십만 번 돌게 됩니다.
    지금은 '책' 이 아니라 '출판사 이름' 끼리 비교합니다. 한 무리에 나오는
    출판사 이름은 보통 한두 개뿐이라 비교 횟수가 거의 사라집니다.
    (※ 실제로 느려서 고친 것이 아니라, 느려질 수 있어서 미리 고쳤습니다)
    """
    known: dict[str, list[int]] = defaultdict(list)   # 출판사 이름 → 책들
    unknown: list[int] = []
    for i in cluster:
        p = by_id[i].get("norm_publisher")
        if p:
            known[p].append(i)
        else:
            unknown.append(i)

    names = list(known)
    if len(names) <= 1:
        return [cluster]           # 출판사가 하나뿐이거나 전부 모릅니다

    # 닮은 이름끼리 먼저 묶습니다 ((주)민음사 와 민음사는 같은 편).
    # 비교 대상은 '이름' 이라서 보통 몇 개뿐입니다.
    name_groups = Groups()
    for x in range(len(names)):
        name_groups.find(x)
        for y in range(x + 1, len(names)):
            if similarity(names[x], names[y]) >= floor:
                name_groups.union(x, y)

    name_parts = name_groups.clusters()
    if len(name_parts) <= 1:
        return [cluster]           # 표기만 다른 같은 출판사였습니다

    # 이름 무리 → 책 목록
    parts: dict[int, list[int]] = {}
    root_of: dict[int, int] = {}   # 책 id → 이름 무리 대표
    for root, idxs in name_parts.items():
        ids: list[int] = []
        for x in idxs:
            ids.extend(known[names[x]])
        parts[root] = ids
        for i in ids:
            root_of[i] = root

    # 출판사를 모르는 책을 어느 쪽에 붙일지 정합니다.
    # 이 무리 안에서 실제로 짝지어진 기록만 봅니다 (없으면 혼자 둡니다).
    for i in unknown:
        best_root, best_score = None, -1.0
        for j, root in root_of.items():
            lo, hi = (i, j) if i < j else (j, i)
            s = pair_score.get((lo, hi))
            if s is not None and s > best_score:
                best_root, best_score = root, s
        if best_root is not None:
            parts[best_root].append(i)
        else:
            parts[i] = [i]         # 붙일 근거가 없으면 혼자

    return [sorted(p) for p in parts.values()]


def rejoin_manual_merges(
    parts: list[list[int]],
    merged: set[tuple[int, int]],
) -> list[list[int]]:
    """
    출판사가 다르다는 이유로 갈라 놓은 조각 중, **사람이 '같은 책' 이라고
    한 짝**이 양쪽에 나뉘어 있으면 다시 합칩니다.

    【왜 필요한가요? — 2026-08-11 대표님 신고】
    "여기서는 같은 책이라고 내가 다 체크하고 깃허브에서 실행까지 시켰는데,
     왜 얘는 하나의 도서페이지로 합쳐지지 않지?"

    『어떻게 살아낼 것인가』 세 서점을 전부 '같은 책' 으로 체크하셨는데
    묶인 권수가 2·1·2 로 남아 있었습니다.

    원인은 출판사 표기였습니다.
        알라딘·교보  필름(Feelm)
        예스24       필름
    이 둘의 닮은 정도가 24% 로 기준(80%)에 못 미쳐서, split_by_publisher
    가 예스24를 **다시 떼어냈습니다.**

    그 함수는 "출판사가 다르면 다른 책" 이라는 규칙을 지킨 것이고, 규칙
    자체는 필요합니다 (민음사 싯다르타와 문학동네 싯다르타가 붙는 것을
    막습니다). 문제는 **사람이 이미 판단한 것까지 되돌렸다**는 점입니다.

    코드에는 "사람이 내린 결정이 최우선" 이라고 적어 두고, 정작 이
    자리에서만 기계가 이겼습니다. 게다가 아무 표시도 안 났습니다.
    대표님은 체크하고 실행까지 하셨는데 화면이 그대로였습니다.
    """
    if len(parts) < 2 or not merged:
        return parts

    where: dict[int, int] = {}
    for idx, part in enumerate(parts):
        for i in part:
            where[i] = idx

    joiner = Groups()
    for idx in range(len(parts)):
        joiner.find(idx)

    joined = 0
    for a, b in merged:
        ia, ib = where.get(a), where.get(b)
        if ia is None or ib is None or ia == ib:
            continue
        joiner.union(ia, ib)
        joined += 1

    if not joined:
        return parts

    out: dict[int, list[int]] = defaultdict(list)
    for idx, part in enumerate(parts):
        out[joiner.find(idx)].extend(part)
    return [sorted(v) for v in out.values()]


def split_same_store(
    cluster: list[int],
    by_id: dict[int, dict],
    pair_score: dict[tuple[int, int], float],
) -> list[list[int]]:
    """
    한 무리에 **같은 서점 상품이 둘 이상** 들어가면 갈라냅니다.

    【2026-08-11 대표님 지시】
    "온라인 3사에 등록된 건데, 짝을 4개 넘긴 건 잘못 등록된다는 거지?
     기본적으로 짝이 4개를 넘기게끔 세팅하면 안 돼."

    맞습니다. 서점이 셋이므로 한 책은 **최대 3권**입니다. 4권이 되려면
    한 서점에 같은 책이 두 번 올라와야 하는데, 그건 실제로는 다른 판형인
    경우가 대부분입니다.

    예전에는 이런 무리를 **세기만** 하고 그냥 뒀습니다("검토 필요로
    표시합니다"). 그래서 4권·5권짜리 무리가 계속 남아 있었습니다.

    가르는 방법: 각 서점에서 **가장 잘 맞는 한 권씩만** 남깁니다.
    남은 것들은 각자 혼자가 됩니다 (나중에 2단계 보충에서 다시 붙을
    기회가 있습니다).
    """
    by_store: dict[int, list[int]] = defaultdict(list)
    for i in cluster:
        by_store[by_id[i]["store_id"]].append(i)

    if all(len(v) == 1 for v in by_store.values()):
        return [cluster]        # 이미 서점마다 한 권씩입니다

    def score_with(i: int, others: list[int]) -> float:
        total = 0.0
        for j in others:
            lo, hi = (i, j) if i < j else (j, i)
            total += pair_score.get((lo, hi), 0.0)
        return total

    # 가장 많은 서점이 걸린 쪽을 중심으로, 서점마다 한 권씩 뽑습니다
    keep: list[int] = []
    for sid, members in by_store.items():
        if len(members) == 1:
            keep.append(members[0])
            continue
        others = [x for x in cluster if by_id[x]["store_id"] != sid]
        best = max(members, key=lambda i: (score_with(i, others), -i))
        keep.append(best)

    dropped = [i for i in cluster if i not in set(keep)]
    return [sorted(keep)] + [[i] for i in dropped]


def fill_missing_store(
    clusters: dict[int, list[int]],
    by_id: dict[int, dict],
    mcfg: dict,
    forbidden: set[tuple[int, int]],
) -> tuple[dict[int, list[int]], int]:
    """
    2개만 묶인 무리에, **홀로 남은 한 권**을 붙여 3권으로 채웁니다.

    【2026-08-11 대표님 지시】
    "묶을 수 있는 충분한 근거가 있는데, 짝이 2개는 묶여있는데 1개가
     부족한 상황에서 그 1개라고 추정할 수 있는 도서가 있다면, 이건
     사실상 하나의 도서로 봐도 괜찮지 않을까?
     엄격한 규칙으로 짝을 다 맞추고 난 후에, 2개의 짝끼리 모여서 이렇게
     하나씩만 빠져있는 경우, 명확하게 홀로 남은 한 개의 도서가 어느 정도
     유사성을 보인다면, 그 경우에 한해서는 해도 된다는 말이지."

    말씀대로 **엄격한 규칙을 다 돌린 뒤에** 마지막으로 한 번만 합니다.
    조건을 아주 좁게 잡았습니다.

      · 2권짜리 무리여야 합니다 (1권·3권은 손대지 않습니다)
      · 붙일 후보는 **그 무리에 없는 서점**의 것이어야 합니다
      · 후보는 **아직 아무 데도 안 묶인** 책이어야 합니다 (뺏어오지 않음)
      · 무리의 **두 권 모두**와 기준 점수를 넘어야 합니다 (한 권만 닮은
        것으로는 안 됩니다)
      · 사람이 '다른 책' 이라고 한 짝은 절대 붙이지 않습니다
      · 후보가 여럿이면 **가장 높은 점수 하나만**. 애매하면 아예 안 붙입니다
    """
    fill = mcfg.get("thresholds", {}).get("fill_min_score")
    if not fill:
        return clusters, 0

    # 어디에도 안 묶인 책 (혼자인 무리)
    alone: dict[int, list[int]] = defaultdict(list)
    for root, part in clusters.items():
        if len(part) == 1:
            alone[by_id[part[0]]["store_id"]].append(part[0])

    added = 0
    for root, part in list(clusters.items()):
        if len(part) != 2:
            continue
        have = {by_id[i]["store_id"] for i in part}
        if len(have) != 2:
            continue                     # 같은 서점 둘이면 손대지 않습니다

        best_id, best_score = None, -1.0
        for sid, ids in alone.items():
            if sid in have:
                continue                 # 이미 있는 서점은 채울 자리가 아닙니다
            for cid in ids:
                scores = []
                ok = True
                for i in part:
                    lo, hi = (cid, i) if cid < i else (i, cid)
                    if (lo, hi) in forbidden:
                        ok = False
                        break
                    r = compare(_cand(by_id[cid]), _cand(by_id[i]), mcfg)
                    if r.decision == "rejected" or r.score < fill:
                        ok = False
                        break
                    scores.append(r.score)
                if not ok:
                    continue
                # 🚨 두 권 **모두** 와 맞아야 합니다. 가장 약한 쪽으로 봅니다.
                s = min(scores)
                if s > best_score:
                    best_id, best_score = cid, s

        if best_id is not None:
            clusters[root] = sorted(part + [best_id])
            del clusters[best_id]
            alone[by_id[best_id]["store_id"]].remove(best_id)
            added += 1

    return clusters, added


def _cand(r: dict) -> Candidate:
    """store_books 한 줄 → 비교용 값"""
    return Candidate(
        id=r["id"],
        store_id=r["store_id"],
        norm_title=r.get("norm_title") or "",
        norm_author=r.get("norm_author"),
        norm_publisher=r.get("norm_publisher"),
        pub_ym=r.get("pub_ym"),
        isbn13=r.get("isbn13"),
        edition_tags=r.get("edition_tags") or [],
        set_volumes=r.get("set_volumes"),
        list_price=r.get("list_price"),
        norm_subtitle=r.get("norm_subtitle"),
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="DB에 저장하지 않고 확인만")
    args = ap.parse_args()
    dry_run = args.dry_run or os.environ.get("DRY_RUN", "").lower() == "true"

    started = time.monotonic()
    mcfg = cfg.load("matching.yaml")

    print("=" * 66)
    print("  같은 책 묶기(매칭) 시작")
    print(f"  모드: {'확인만 (저장 안 함)' if dry_run else '실제 저장'}")
    print(f"  기준점: {mcfg['thresholds']['auto_high']}점 이상 자동병합 / "
          f"{mcfg['thresholds']['auto_low']}점 이상 검토대기")
    print("=" * 66)

    client = db.connect()

    rows = db.fetch_all_store_books(client)
    print(f"\n서점별 도서 {len(rows):,}권을 읽었습니다.")
    if not rows:
        print("묶을 도서가 없습니다. 먼저 수집을 실행하세요.")
        return 1

    by_id = {r["id"]: r for r in rows}
    cands = [
        Candidate(
            id=r["id"],
            store_id=r["store_id"],
            norm_title=r.get("norm_title") or "",
            norm_author=r.get("norm_author"),
            norm_publisher=r.get("norm_publisher"),
            pub_ym=r.get("pub_ym"),
            isbn13=r.get("isbn13"),
            edition_tags=r.get("edition_tags") or [],
            set_volumes=r.get("set_volumes"),
            list_price=r.get("list_price"),
            norm_subtitle=r.get("norm_subtitle"),
        )
        for r in rows
    ]

    manual = db.fetch_manual_decisions(client)
    if manual:
        print(f"사람이 직접 내린 결정 {len(manual)}건을 우선 적용합니다.")

    # ---- 후보 좁히기 ----
    print("\n▶ 비교 후보 좁히는 중...")
    blocks = build_blocks(cands, mcfg)
    total_pairs = sum(len(g) * (len(g) - 1) // 2 for g in blocks)
    print(f"  묶음 {len(blocks):,}개 · 비교할 짝 최대 {total_pairs:,}쌍")

    # ---- 비교 ----
    print("\n▶ 비교 중...")
    groups = Groups()
    for c in cands:
        groups.find(c.id)      # 혼자인 책도 무리에 등록

    match_rows: list[dict] = []
    seen_pairs: set[tuple[int, int]] = set()
    # 정가가 달라서 갈라낸 짝의 수 (서점 짝별)
    price_reject: dict[tuple[int, int], int] = {}
    # 양쪽 다 정가를 아는 짝의 수 (비율을 내려면 분모가 필요합니다)
    price_seen: dict[tuple[int, int], int] = {}
    counts = {"auto_high": 0, "auto_low": 0, "rejected": 0, "by_isbn": 0}

    for group in blocks:
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                a, b = group[i], group[j]
                lo, hi = (a.id, b.id) if a.id < b.id else (b.id, a.id)
                if (lo, hi) in seen_pairs:
                    continue
                seen_pairs.add((lo, hi))

                # 사람이 내린 결정이 최우선
                decided = manual.get((lo, hi))
                if decided == "manual_merge":
                    groups.union(lo, hi)
                    continue
                if decided == "manual_split":
                    continue

                if a.list_price and b.list_price:
                    key = (min(a.store_id, b.store_id),
                           max(a.store_id, b.store_id))
                    price_seen[key] = price_seen.get(key, 0) + 1

                # ISBN 이 양쪽에 다 있으면 그것으로 확정
                result = compare_with_isbn(a, b, mcfg)
                if result is not None:
                    if result.is_same_book:
                        counts["by_isbn"] += 1
                else:
                    result = compare(a, b, mcfg)

                if result.decision == "rejected":
                    counts["rejected"] += 1
                    # 【2026-08-11 — 정가로 갈라낸 짝을 서점 짝별로 셉니다】
                    # 정가가 다르면 다른 책으로 확정 거부합니다. 그런데
                    # 어느 서점이 가격을 잘못 읽으면 **멀쩡한 짝이 조용히
                    # 갈라집니다.** 실제로 교보에서 할인율과 가격이
                    # 이어붙어 2,918,000원이 저장된 적이 있습니다.
                    # 화면에 아무 표시도 안 나기 때문에, 여기서 세어
                    # 두고 아래에서 서점 짝별로 보여 줍니다.
                    if result.reasons.get("rejected_by") == "정가가 다름":
                        key = (min(a.store_id, b.store_id),
                               max(a.store_id, b.store_id))
                        price_reject[key] = price_reject.get(key, 0) + 1
                    continue

                counts[result.decision] += 1
                groups.union(lo, hi)
                match_rows.append({
                    "store_book_a": lo,
                    "store_book_b": hi,
                    "score": result.score,
                    "reasons": result.reasons,
                    "decision": result.decision,
                    # 검토 화면의 '되돌리기' 가 쓰는 값입니다.
                    # 사람이 고친 뒤에도 "원래 기계는 뭐라고 했는지" 를
                    # 알 수 있어야 되돌릴 수 있습니다.
                    "auto_decision": result.decision,
                })

    print(f"  자동병합 {counts['auto_high']:,}쌍 "
          f"(그중 ISBN 확정 {counts['by_isbn']:,}쌍) · "
          f"검토대기 {counts['auto_low']:,}쌍 · 거부 {counts['rejected']:,}쌍")

    # ---- 정가 건강 점검 (2026-08-11) ----
    #  도서정가제상 정가는 출판사가 정한 하나의 값이라 3사가 같아야 합니다.
    #  그러니 '정가가 달라서 갈라낸 비율' 은 원래 낮아야 정상입니다.
    #  한 서점만 유난히 높으면 **그 서점 가격을 잘못 읽고 있는 것**입니다.
    #  (교보에서 할인율과 가격이 이어붙어 2,918,000원이 저장된 적이 있습니다)
    if price_seen:
        names = {1: "교보", 2: "예스24", 3: "알라딘"}
        print("  · 정가 점검 — 양쪽 다 정가를 아는 짝 중, 정가가 달라 갈라낸 비율")
        worst = 0.0
        for key in sorted(price_seen):
            seen_n = price_seen[key]
            bad_n = price_reject.get(key, 0)
            pct = 100.0 * bad_n / seen_n if seen_n else 0.0
            worst = max(worst, pct)
            mark = "✅" if pct < 10 else ("⚠️" if pct < 25 else "🚨")
            print(f"      {mark} {names.get(key[0], key[0])}↔{names.get(key[1], key[1])}: "
                  f"{bad_n:,} / {seen_n:,}쌍 ({pct:.1f}%)")
        if worst >= 25:
            print("      🚨 한 서점 짝만 유난히 높으면 그 서점 가격을 잘못")
            print("         읽고 있는 것입니다. config/matching.yaml 의")
            print("         price_hard_stores 에서 그 서점 번호를 빼시고")
            print("         저에게 알려 주세요. (그때까지 멀쩡한 짝이 갈라집니다)")

    # ---- 무리 만들기 ----
    raw_clusters = groups.clusters()

    # 출판사가 섞인 무리를 갈라냅니다 (위 split_by_publisher 설명 참고)
    floor = mcfg["thresholds"].get("publisher_hard_floor", 0.80)
    pair_score = {(m["store_book_a"], m["store_book_b"]): m["score"]
                  for m in match_rows}
    clusters: dict[int, list[int]] = {}
    split_count = 0

    # 사람이 누른 결정을 다시 적용하기 위한 재료 (아래 split_by_manual 설명)
    forbidden = {p for p, d in manual.items() if d == "manual_split"}
    same_store_split = 0
    edges: list[tuple[float, int, int]] = [
        (float(m["score"]), m["store_book_a"], m["store_book_b"])
        for m in match_rows
    ]
    # 사람이 '같은 책' 이라고 한 짝은 점수를 무한대로 줍니다.
    # 기계 점수보다 사람 결정이 항상 먼저입니다.
    edges += [(float("inf"), a, b)
              for (a, b), d in manual.items() if d == "manual_merge"]
    manual_split_count = 0

    # 사람이 '같은 책' 이라고 한 짝 (아래 rejoin_manual_merges 설명)
    merged_pairs = {p for p, d in manual.items() if d == "manual_merge"}
    rejoined = 0

    for cluster in raw_clusters.values():
        parts = ([cluster] if len(cluster) < 2
                 else split_by_publisher(cluster, by_id, pair_score, floor))
        if len(parts) > 1:
            split_count += 1
            # 🚨 출판사로 가른 것이 사람 결정을 덮어쓰면 안 됩니다.
            #    "사람이 내린 결정이 최우선" 은 여기서도 지켜야 합니다.
            before = len(parts)
            parts = rejoin_manual_merges(parts, merged_pairs)
            if len(parts) < before:
                rejoined += 1

        # 출판사로 가른 뒤, 사람이 '다른 책' 이라고 한 짝을 마저 갈라냅니다
        final_parts: list[list[int]] = []
        for part in parts:
            pieces = split_by_manual(part, edges, forbidden)
            if len(pieces) > 1:
                manual_split_count += 1
            final_parts.extend(pieces)

        # 🚨 한 서점 상품이 둘 이상 들어간 무리를 갈라냅니다 (4권 이상 방지)
        #    2026-08-11 대표님 지시: "짝이 4개를 넘기게끔 세팅하면 안 돼."
        for part in final_parts:
            for piece in split_same_store(part, by_id, pair_score):
                if len(piece) > 1:
                    same_store_split += 1 if piece is not part else 0
                clusters[min(piece)] = sorted(piece)

    if split_count:
        print(f"  ⚠️ 출판사가 섞여 있어 갈라낸 무리 {split_count:,}종 "
              f"→ 출판사별로 따로 셉니다.")
    if manual_split_count:
        print(f"  ✂️ 사람이 '다른 책' 이라고 한 짝 때문에 갈라낸 무리 "
              f"{manual_split_count:,}종.")
    if rejoined:
        print(f"  🤝 출판사 표기가 달라 갈라졌지만 사람이 '같은 책' 이라고 한 "
              f"무리 {rejoined:,}종 → 다시 합쳤습니다.")

    # -------------------------------------------------------------------------
    #  마지막 단계 — 2권짜리 무리에 홀로 남은 한 권을 채웁니다 (2026-08-11)
    #
    #  대표님 말씀대로 **엄격한 규칙을 다 돌린 뒤에** 한 번만 합니다.
    #  두 권 모두와 기준 점수를 넘어야 하고, 후보가 애매하면 안 붙입니다.
    # -------------------------------------------------------------------------
    clusters, filled = fill_missing_store(clusters, by_id, mcfg, forbidden)
    if filled:
        print(f"  🧩 2권만 묶여 있던 무리에 남은 한 권을 채웠습니다 — {filled:,}종")

    # 갈라낸 뒤의 소속을 다시 계산합니다 (아래 경고에서 씁니다)
    owner = {i: root for root, part in clusters.items() for i in part}

    # 🚨 이제 4권 이상인 무리는 없어야 합니다. 있으면 규칙이 새는 것입니다.
    too_big = [c for c in clusters.values() if len(c) > 3]
    if too_big:
        print(f"  🚨 4권 이상 묶인 무리가 {len(too_big):,}종 남았습니다 "
              f"(서점이 셋이므로 있을 수 없습니다). 알려 주세요.")
    else:
        print("  ✅ 4권 이상 묶인 무리 없음 (서점이 셋이므로 최대 3권)")

    multi = {k: v for k, v in clusters.items() if len(v) > 1}
    print(f"\n▶ 결과: 도서 {len(clusters):,}종 "
          f"(그중 2개 서점 이상에서 발견된 책 {len(multi):,}종)")

    # 한 무리에 같은 서점 상품이 2개 이상 들어간 경우를 셉니다.
    #
    # 【왜 이런 일이 생기나요?】
    # "같은 서점끼리는 안 묶는다" 는 규칙이 있지만, 다른 서점을 다리 삼아
    # 간접적으로 이어질 수 있습니다.
    #   알라딘A ─ 예스24X ─ 알라딘B  →  A 와 B 가 한 무리
    # 실제로는 다른 판형인 경우가 많습니다. 자동으로 갈라내면 오히려
    # 맞는 것까지 깨질 수 있으므로, '검토 필요' 로 표시만 합니다.
    dup_store = [
        c for c in multi.values()
        if len({by_id[i]["store_id"] for i in c}) < len(c)
    ]
    if dup_store:
        print(f"  🚨 같은 서점 상품이 2개 이상 섞인 무리가 {len(dup_store):,}종 "
              f"남았습니다. 갈라내는 규칙이 새는 것이니 알려 주세요.")
    else:
        print("  ✅ 같은 서점 상품이 두 번 들어간 무리 없음")

    # 위에서 갈라냈는데도 여전히 한 무리인 짝이 있는지 확인합니다.
    #
    # 【왜 또 보나요?】
    # split_by_manual 은 너무 큰 무리(60권 초과)에는 손대지 않습니다.
    # 그런 경우 대표님이 [다른 책] 을 눌렀는데도 화면은 그대로입니다.
    # 조용히 넘어가면 버튼이 거짓말을 한 것이 되므로 반드시 알립니다.
    warned = 0
    for (lo, hi), d in manual.items():
        if d == "manual_split" and owner.get(lo, lo) == owner.get(hi, hi):
            warned += 1
    if warned:
        print(f"  🚨 사람이 '다른 책' 이라고 한 짝 {warned}건을 갈라내지 "
              f"못했습니다. 무리가 너무 커서 손대지 않은 경우입니다.")
        print(f"     그 짝은 검토 화면에서 눌러도 순위에 반영되지 않습니다.")

    # 반대쪽도 봅니다 — '같은 책' 이라고 했는데 안 묶인 경우.
    #
    # 【2026-08-11】 이 확인이 없어서 대표님이 직접 발견하셨습니다.
    # 체크하고 실행까지 하셨는데 화면이 그대로였고, 로그에도 아무 말이
    # 없었습니다. 한쪽만 확인하고 있었던 것입니다.
    #
    # ⚠️ 양쪽 다 이번 무리에 있는 짝만 셉니다. 순위에서 빠진 옛날 책은
    #    안 묶이는 것이 당연해서, 그것까지 세면 매일 헛경고가 뜹니다.
    not_merged = 0
    for (lo, hi), d in manual.items():
        if d != "manual_merge":
            continue
        if lo in owner and hi in owner and owner[lo] != owner[hi]:
            not_merged += 1
    if not_merged:
        print(f"  🚨 사람이 '같은 책' 이라고 한 짝 {not_merged}건이 "
              f"묶이지 않았습니다.")
        print(f"     체크하신 것이 순위에 반영되지 않습니다. 알려 주세요.")

    # ---- 예시 보여주기 ----
    print("\n  ── 묶인 예시 (최대 5건) ──")
    for cluster in list(multi.values())[:5]:
        rep = pick_representative([by_id[i] for i in cluster])
        print(f"   • {rep['title']}  /  {rep['author']}  /  {rep['publisher']}")
        for i in cluster:
            r = by_id[i]
            print(f"       [{STORE_CODE.get(r['store_id'], '?'):<6}] {r['raw_title']}")

    if dry_run:
        print(f"\n[확인 모드] 저장하지 않았습니다. "
              f"({round(time.monotonic() - started, 1)}초)")
        return 0

    # ---- 저장 ----
    print("\n▶ 저장 중...")
    db.save_matches(client, match_rows)

    scores_by_pair = {(m["store_book_a"], m["store_book_b"]): m["decision"]
                      for m in match_rows}

    # 한 건씩 저장하면 도서 6,000종에 요청이 1만 건 넘게 나갑니다.
    # (실제로 그렇게 만들었다가 10분이 넘어 취소했습니다)
    # 그래서 먼저 전부 계산해 두고, 마지막에 묶어서 한 번에 보냅니다.
    keep_book_ids: set[int] = set()
    to_insert: list[dict] = []          # 새로 만들 도서 마스터
    to_insert_members: list[list] = []  # 그 도서에 속할 서점 도서들
    to_update: list[dict] = []          # 이미 있는 도서 마스터 갱신
    to_link: list[dict] = []            # 서점 도서 ↔ 도서 마스터 연결

    def mark_links(book_id: int, members: list[dict]) -> None:
        for m in members:
            if m.get("book_id") == book_id:
                continue      # 이미 올바르게 연결돼 있으면 건드리지 않습니다
            # 비어 있으면 안 되는 칸(store_id / store_book_key / raw_title)을
            # 함께 보내야 합니다. 하나라도 빠지면 저장이 통째로 실패합니다.
            if not m.get("store_book_key"):
                raise RuntimeError(
                    f"서점 상품번호가 비어 있습니다 (store_books.id={m['id']}). "
                    f"DB 에서 읽어올 때 store_book_key 를 빠뜨렸는지 확인하세요."
                )
            to_link.append({
                "id": m["id"],
                "store_id": m["store_id"],
                "store_book_key": m["store_book_key"],
                "raw_title": m["raw_title"],
                "book_id": book_id,
            })

    # -------------------------------------------------------------------------
    # 【한 번호를 두 무리가 나눠 가지면 안 됩니다 — 2026-08-08】
    #
    # 규칙이 엄격해지면(예: 출판사가 다르면 다른 책) 예전에 한 덩어리였던
    # 무리가 여러 개로 갈라집니다. 그런데 갈라진 조각들은 저마다
    # "나도 예전 도서번호 100번을 쓰고 있었다" 고 주장합니다.
    # 그대로 두면 네 조각이 전부 100번을 집어가서, 규칙을 고쳤는데도
    # 데이터베이스에서는 여전히 한 권으로 묶여 있게 됩니다.
    #
    # 그래서 한 번호는 '먼저 온 무리' 하나만 쓰고, 나머지는 새 번호를 받습니다.
    # 어느 무리가 먼저인지는 실행할 때마다 달라지면 안 되므로 정렬해 둡니다.
    # -------------------------------------------------------------------------
    claimed_book_ids: set[int] = set()
    ordered_clusters = sorted(clusters.values(), key=lambda c: min(c))

    for cluster in ordered_clusters:
        members = [by_id[i] for i in cluster]
        rep = pick_representative(members)

        # 이 무리의 신뢰도
        if len(cluster) == 1:
            confidence = "single"
        else:
            pair_decisions = [
                scores_by_pair.get((min(x, y), max(x, y)))
                for x in cluster for y in cluster if x < y
            ]
            manual_here = any(
                manual.get((min(x, y), max(x, y))) == "manual_merge"
                for x in cluster for y in cluster if x < y
            )
            # 같은 서점 상품이 2개 이상 섞였으면 다른 판형일 수 있으므로 검토 대상
            same_store_mixed = (
                len({m["store_id"] for m in members}) < len(members)
            )
            if manual_here:
                confidence = "manual"
            elif same_store_mixed or "auto_low" in pair_decisions:
                confidence = "low"
            else:
                confidence = "high"
        rep["match_confidence"] = confidence

        # 이미 만들어진 도서 마스터가 있으면 그걸 재사용 (주소가 안 바뀌도록).
        # 단, 다른 무리가 이미 가져간 번호는 쓸 수 없습니다.
        existing = sorted(
            m["book_id"] for m in members
            if m.get("book_id") and m["book_id"] not in claimed_book_ids
        )
        if existing:
            book_id = existing[0]
            claimed_book_ids.add(book_id)
            keep_book_ids.add(book_id)
            to_update.append({"id": book_id, **rep})
            mark_links(book_id, members)
        else:
            to_insert.append(rep)
            to_insert_members.append(members)

    # ---- 여기서부터 실제로 보냅니다 (묶어서) ----
    print(f"  · 새 도서 마스터 {len(to_insert):,}종 만드는 중...")
    new_ids = db.insert_books(client, to_insert)
    for book_id, members in zip(new_ids, to_insert_members):
        keep_book_ids.add(book_id)
        mark_links(book_id, members)

    print(f"  · 기존 도서 마스터 {len(to_update):,}종 갱신하는 중...")
    db.update_books(client, to_update)

    print(f"  · 서점 도서 {len(to_link):,}건 연결하는 중...")
    db.link_store_books_bulk(client, to_link)

    orphans = db.delete_orphan_books(client, keep_book_ids)

    print(f"  ✅ 도서 마스터: 새로 {len(new_ids):,}종 · 갱신 {len(to_update):,}종 · "
          f"빈 껍데기 정리 {orphans:,}종")
    print(f"  ✅ 매칭 근거 {len(match_rows):,}건 저장")
    print(f"\n완료 ({round(time.monotonic() - started, 1)}초)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
