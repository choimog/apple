"""
=============================================================================
 이름 하나로 모으기 — 출판사·저자 순위가 꼬이는 것을 막습니다
=============================================================================

 【무엇이 문제였나요? — 2026-08-12 대표님 지적】

   "그런데 왜 웰컴에 보이는 출판사와 저자 순위는 계속 꼬여있는 상태야?"

 웰컴 화면의 [출판사 TOP 8] · [저자 TOP 8] 은 도서 마스터(books)에
 적힌 **대표 출판사 이름 글자 그대로** 세서 줄을 세웁니다.
 그런데 그 이름은 **서점이 적은 대로** 넣고 있었습니다.

     교보문고  YBM(와이비엠)
     예스24    YBM
     알라딘    와이비엠

 어느 이름이 대표가 될지는 그 책을 어느 서점이 갖고 있었느냐로 정해집니다.
 그래서 **같은 출판사인데 책마다 다른 이름표**가 붙고, 순위표에서는
 한 곳이 두세 줄로 쪼개집니다. 점수도 그만큼 나뉩니다.

     YBM          12권  3,010점
     와이비엠      8권  1,980점     ← 원래 한 줄이어야 합니다
     YBM(와이비엠)  5권  1,240점

 저자도 똑같습니다. '알베르 카뮈' 와 '알베르 까뮈' 가 따로 섭니다.

 【어떻게 고치나요】

 매칭이 도서 마스터를 만들 때, 서점 이름을 그대로 쓰지 않고
 **온 자료를 통틀어 정한 이름 하나**를 씁니다.

     윌북(willbook) · 윌북            →  둘 다 '윌북'
     YBM(와이비엠) · YBM · 와이비엠   →  셋 다 'YBM'
     알베르 카뮈 · 알베르 까뮈        →  둘 다 '알베르 카뮈'

 ※ 데이터베이스 구조는 건드리지 않습니다. [도서 매칭] 한 번이면
   이미 모아 둔 자료에도 그대로 적용됩니다.

 ※ 이건 **화면에 쓸 이름**을 고르는 일입니다. 어떤 책과 어떤 책을
   같은 책으로 볼지(매칭)는 전혀 건드리지 않습니다.
=============================================================================
"""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Iterable

from .match import publisher_variants

# 괄호가 든 이름은 화면 이름으로 덜 좋아합니다 ('윌북' 이 '윌북(willbook)' 보다 낫습니다)
_BRACKETS = "()（）[]［］{}"


def alias_groups(
    names: list[str], generic_max: int = 8
) -> tuple[list[list[int]], list[str]]:
    """
    출판사 이름들을 **같은 곳끼리** 묶습니다. 돌려주는 값은 자리번호 묶음입니다.

    묶는 근거는 딱 하나, **괄호로 밝혀 준 다른 이름**입니다.

        윌북(willbook)  →  {윌북(willbook), 윌북, willbook}
        윌북            →  {윌북}
                             └ '윌북' 이 겹칩니다 → 같은 곳

    ⚠️ 여기서는 '닮았다' 는 이유로 묶지 않습니다. 글자가 딱 겹칠 때만
       묶습니다. 온 자료를 통틀어 한 번에 묶는 일이라, 조금이라도
       헐거우면 남남인 출판사가 줄줄이 딸려 들어옵니다.

    ⚠️ 흔한 낱말은 다리로 쓰지 않습니다. 예를 들어 '중앙북스(books)' 의
       'books' 같은 조각이 여기저기서 겹치면, 상관없는 출판사들이
       한 덩어리가 됩니다. 그래서 **{generic_max}곳이 넘게 겹치는 조각은
       흔한 낱말로 보고 버립니다.** 버린 낱말은 화면에 찍어 드립니다.
    """
    parent = list(range(len(names)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    by_variant: dict[str, list[int]] = defaultdict(list)
    for i, n in enumerate(names):
        for v in publisher_variants(n):
            if len(v) >= 2:          # 한 글자짜리는 다리로 쓰지 않습니다
                by_variant[v].append(i)

    ignored: list[str] = []
    for v, idxs in by_variant.items():
        if len(idxs) > generic_max:
            ignored.append(v)
            continue
        for j in idxs[1:]:
            ra, rb = find(idxs[0]), find(j)
            if ra != rb:
                parent[rb] = ra

    groups: dict[int, list[int]] = {}
    for i in range(len(names)):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values()), sorted(ignored)


def choose_display(forms: Counter) -> str:
    """
    한 무리 안에서 **화면에 쓸 이름 하나**를 고릅니다.

    순서대로 따집니다.
      ① 괄호가 없는 것            '윌북' > '윌북(willbook)'
      ② 서점에 더 많이 적힌 것    실제로 흔히 쓰는 표기
      ③ 짧은 것
      ④ 가나다순                  ← 실행할 때마다 답이 달라지면 안 됩니다
    """
    return min(
        forms,
        key=lambda f: (any(c in f for c in _BRACKETS), -forms[f], len(f), f),
    )


def canonical_map(
    pairs: Iterable[tuple[str | None, str | None]],
    *,
    use_alias: bool,
    generic_max: int = 8,
) -> tuple[dict[str, str], list[str], dict[str, Counter]]:
    """
    '정규화한 이름 → 화면에 쓸 이름' 표를 만듭니다.

    pairs 는 (정규화한 이름, 서점이 적은 그대로) 짝을 계속 흘려보내면 됩니다.
    서점별 도서 한 줄이 한 짝입니다. 많이 나온 표기가 이깁니다.

    use_alias
        True  (출판사) 괄호로 밝혀 준 다른 이름끼리도 한 무리로 묶습니다.
        False (저자)   된소리만 푼 값이 같으면 이미 한 무리입니다.
                       사람 이름을 괄호로 이어 묶으면 위험합니다.
    """
    forms: dict[str, Counter] = defaultdict(Counter)
    for key, raw in pairs:
        if not key or not raw:
            continue
        raw = raw.strip()
        if raw:
            forms[key][raw] += 1

    keys = list(forms)
    if use_alias:
        groups, ignored = alias_groups(keys, generic_max)
    else:
        groups, ignored = [[i] for i in range(len(keys))], []

    out: dict[str, str] = {}
    for g in groups:
        merged: Counter = Counter()
        for i in g:
            merged.update(forms[keys[i]])
        name = choose_display(merged)
        for i in g:
            out[keys[i]] = name
    return out, ignored, dict(forms)


def merge_examples(
    canon: dict[str, str], forms: dict[str, Counter], limit: int = 5
) -> tuple[list[str], int]:
    """
    '이런 표기들을 한 이름으로 모았습니다' 예시와, 모아 없앤 표기 수.

    대표님이 화면에서 바로 확인하실 수 있게, 가장 많이 흩어져 있던
    것부터 보여 줍니다.
    """
    merged: dict[str, set[str]] = defaultdict(set)
    for key, display in canon.items():
        for raw in forms.get(key, ()):
            if raw != display:
                merged[display].add(raw)
    lines = [
        f"{display} ← {' · '.join(sorted(others))}"
        for display, others in sorted(merged.items())
        if others
    ]
    saved = sum(len(v) for v in merged.values())
    lines.sort(key=lambda s: (-s.count("·"), -len(s), s))
    return lines[:limit], saved
