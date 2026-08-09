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

                # ISBN 이 양쪽에 다 있으면 그것으로 확정
                result = compare_with_isbn(a, b, mcfg)
                if result is not None:
                    if result.is_same_book:
                        counts["by_isbn"] += 1
                else:
                    result = compare(a, b, mcfg)

                if result.decision == "rejected":
                    counts["rejected"] += 1
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
    edges: list[tuple[float, int, int]] = [
        (float(m["score"]), m["store_book_a"], m["store_book_b"])
        for m in match_rows
    ]
    # 사람이 '같은 책' 이라고 한 짝은 점수를 무한대로 줍니다.
    # 기계 점수보다 사람 결정이 항상 먼저입니다.
    edges += [(float("inf"), a, b)
              for (a, b), d in manual.items() if d == "manual_merge"]
    manual_split_count = 0

    for cluster in raw_clusters.values():
        parts = ([cluster] if len(cluster) < 2
                 else split_by_publisher(cluster, by_id, pair_score, floor))
        if len(parts) > 1:
            split_count += 1

        # 출판사로 가른 뒤, 사람이 '다른 책' 이라고 한 짝을 마저 갈라냅니다
        final_parts: list[list[int]] = []
        for part in parts:
            pieces = split_by_manual(part, edges, forbidden)
            if len(pieces) > 1:
                manual_split_count += 1
            final_parts.extend(pieces)

        for part in final_parts:
            clusters[min(part)] = sorted(part)

    if split_count:
        print(f"  ⚠️ 출판사가 섞여 있어 갈라낸 무리 {split_count:,}종 "
              f"→ 출판사별로 따로 셉니다.")
    if manual_split_count:
        print(f"  ✂️ 사람이 '다른 책' 이라고 한 짝 때문에 갈라낸 무리 "
              f"{manual_split_count:,}종.")

    # 갈라낸 뒤의 소속을 다시 계산합니다 (아래 경고에서 씁니다)
    owner = {i: root for root, part in clusters.items() for i in part}

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
        print(f"  ⚠️ 같은 서점 상품이 2개 이상 섞인 무리 {len(dup_store):,}종 "
              f"→ '검토 필요' 로 표시합니다 (다른 판형일 가능성).")

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
