"""
교보문고 데이터 위치 정밀 탐침.

【왜 필요한가요?】
교보 목록 페이지의 HTML 을 받아보니 도서 데이터가 없고
'animate-shimmer'(로딩 중 회색 뼈대) 자리표시자만 160개 들어 있었습니다.
= 브라우저가 자바스크립트를 실행해야 도서가 채워지는 구조입니다.

브라우저 자동화(헤드리스)는 느리고 무겁습니다. 그 전에,
데이터가 HTML 안 어딘가에 이미 들어 있지는 않은지 확인합니다.

Next.js 앱은 보통 아래 셋 중 하나로 데이터를 심어둡니다:
  1) <script id="__NEXT_DATA__">   (구버전 Pages Router)
  2) self.__next_f.push([...])     (신버전 App Router, RSC 페이로드)
  3) 아무것도 없음 → 브라우저 자동화 필요

여기서 발견되면 브라우저 없이 빠르게 수집할 수 있습니다.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common.http import PoliteClient  # noqa: E402

USER_AGENT = "BestsellerTracker/1.0 (+https://github.com/choimog/apple)"
URL = "https://store.kyobobook.co.kr/bestseller/online/weekly/domestic?page=1"

# 도서 데이터라면 반드시 들어 있을 법한 표시들
BOOK_HINTS = [
    "saleCmdtNm",     # 교보 API 에서 흔한 상품명 필드
    "cmdtName", "prdtNm", "prodNm", "bookName",
    "saleCmdtid", "cmdtCode", "salePrice",
    "저자", "출판사", "출간",
]


def sep(t: str) -> None:
    print("\n" + "=" * 70)
    print(f"  {t}")
    print("=" * 70)


def main() -> int:
    with PoliteClient(user_agent=USER_AGENT, delay_min=1.5, delay_max=2.5,
                      referer="https://store.kyobobook.co.kr") as c:
        resp = c.get(URL)
    html = resp.text
    print(f"✅ HTTP {resp.status_code}, 본문 {len(html):,}자")

    # --- 1. 로딩 뼈대(스켈레톤) 개수 — JS 렌더링의 결정적 증거 ---
    sep("1. 로딩 뼈대(skeleton) 확인")
    shimmer = len(re.findall(r"animate-shimmer", html))
    print(f"  animate-shimmer (로딩 중 회색 자리표시자): {shimmer}개")
    print("  → 많이 나오면 '아직 데이터가 안 채워진 껍데기'라는 뜻입니다.")

    # --- 2. __NEXT_DATA__ ---
    sep("2. __NEXT_DATA__ (구버전 Next.js 데이터)")
    m = re.search(
        r'<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)</script>', html
    )
    if m:
        print(f"  ✅ 발견! {len(m.group(1)):,}자")
        try:
            data = json.loads(m.group(1))
            print(f"  최상위 키: {list(data.keys())}")
        except Exception as exc:  # noqa: BLE001
            print(f"  (JSON 해석 실패: {exc})")
    else:
        print("  ❌ 없음")

    # --- 3. self.__next_f (신버전 App Router RSC 데이터) ---
    sep("3. self.__next_f (신버전 Next.js RSC 데이터)")
    pushes = re.findall(r"self\.__next_f\.push\(", html)
    print(f"  __next_f.push 호출 횟수: {len(pushes)}개")

    if pushes:
        # 페이로드를 모두 이어붙여서 도서 데이터가 있는지 봅니다
        chunks = re.findall(
            r'self\.__next_f\.push\(\[\d+,\s*"((?:[^"\\]|\\.)*)"\]\)', html
        )
        merged = ""
        for ch in chunks:
            try:
                merged += json.loads(f'"{ch}"')
            except Exception:  # noqa: BLE001
                merged += ch
        print(f"  이어붙인 페이로드 길이: {len(merged):,}자")
        hangul = len(re.findall(r"[가-힣]", merged))
        print(f"  페이로드 안 한글: {hangul:,}자")

        sep("4. 페이로드 안에 도서 데이터가 있는가")
        found_any = False
        for hint in BOOK_HINTS:
            n = merged.count(hint)
            if n:
                found_any = True
                print(f"  ✅ '{hint}' {n}회")
        if not found_any:
            print("  ❌ 도서 관련 표시를 하나도 못 찾음")

        # 실제 내용 일부를 보여줍니다
        sep("5. 페이로드 샘플 (한글이 몰려 있는 부분)")
        best, best_score = 0, 0
        for i in range(0, max(1, len(merged) - 1200), 600):
            score = len(re.findall(r"[가-힣]", merged[i:i + 1200]))
            if score > best_score:
                best, best_score = i, score
        print(f"  (위치 {best}, 한글 {best_score}자 구간)")
        print(merged[best:best + 1800])
    else:
        print("  ❌ 없음")

    # --- 6. 결론 ---
    sep("결론")
    if m or (pushes and any(h in html for h in BOOK_HINTS)):
        print("  → HTML 안에 데이터가 들어 있을 가능성이 있습니다.")
        print("     브라우저 자동화 없이 파싱을 시도해 볼 수 있습니다.")
    else:
        print("  → HTML 에 도서 데이터가 없습니다.")
        print("     교보만 헤드리스 브라우저(화면 없는 브라우저)가 필요합니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
