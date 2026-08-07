"""
=============================================================================
 정밀 탐침(probe) — Phase 2 준비
=============================================================================

 두 가지를 한 번에 확인합니다.

 【1】 Supabase 연결 + 표(테이블) 생성 확인
      - db/schema.sql 을 제대로 실행했는지 검증
      - GitHub Secrets 가 올바로 등록됐는지 검증

 【2】 알라딘 목록의 정확한 내부 구조 덤프
      - 도서 한 칸(ss_book_box)의 HTML을 그대로 출력
      - 여기서 얻은 구조로 선택자(값 뽑는 규칙)를 정확히 작성합니다
      - ※ 목록 페이지 1건만 요청합니다. 상세 페이지 진입 없음.

 실행: GitHub Actions → [정밀 탐침 (probe)] → Run workflow
=============================================================================
"""

from __future__ import annotations

import os
import re
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common.http import PoliteClient  # noqa: E402

USER_AGENT = "BestsellerTracker/1.0 (+https://github.com/choimog/apple)"

ALADIN_URL = (
    "https://www.aladin.co.kr/shop/common/wbest.aspx"
    "?BranchType=1&BestType=Bestseller&page=1"
)

# db/schema.sql 로 만들어졌어야 하는 표 목록
EXPECTED_TABLES = [
    "stores", "categories", "books", "store_books", "book_matches",
    "rankings", "book_meta", "crawl_logs", "daily_reports",
    "profiles", "public_links",
]


def sep(title: str) -> None:
    print("\n" + "=" * 70)
    print(f"  {title}")
    print("=" * 70)


# -----------------------------------------------------------------------------
#  [1] Supabase 확인
# -----------------------------------------------------------------------------
def check_supabase() -> bool:
    sep("[1] Supabase 연결 및 표 생성 확인")

    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()

    if not url or not key:
        print("❌ GitHub Secrets 가 설정되지 않았습니다.")
        print(f"   SUPABASE_URL           : {'있음' if url else '없음 ← 등록 필요'}")
        print(f"   SUPABASE_SERVICE_ROLE_KEY: {'있음' if key else '없음 ← 등록 필요'}")
        return False

    # 키 자체는 절대 출력하지 않습니다. 형태만 확인합니다.
    print(f"✅ SUPABASE_URL 등록됨 (…{url[-24:]})")
    print(f"✅ SUPABASE_SERVICE_ROLE_KEY 등록됨 (길이 {len(key)}자)")

    try:
        from supabase import create_client
    except ImportError:
        print("❌ supabase 라이브러리를 불러오지 못했습니다.")
        return False

    try:
        client = create_client(url, key)
    except Exception as exc:
        print(f"❌ 접속 실패: {type(exc).__name__}: {exc}")
        return False

    print("\n표(테이블) 확인:")
    ok, missing = 0, []
    for table in EXPECTED_TABLES:
        try:
            res = client.table(table).select("*", count="exact").limit(0).execute()
            print(f"  ✅ {table:<15} (현재 {res.count}건)")
            ok += 1
        except Exception as exc:
            msg = str(exc)
            short = msg[:110].replace("\n", " ")
            print(f"  ❌ {table:<15} {short}")
            missing.append(table)

    print(f"\n결과: {ok}/{len(EXPECTED_TABLES)} 개 표 정상")
    if missing:
        print(f"⚠️ 없는 표: {', '.join(missing)}")
        print("   → db/schema.sql 을 Supabase SQL Editor 에서 다시 실행해 주세요.")
        return False

    # stores 기본 데이터가 들어갔는지 (schema.sql 의 INSERT 부분)
    try:
        res = client.table("stores").select("code,name").execute()
        names = ", ".join(f"{r['code']}({r['name']})" for r in res.data)
        print(f"✅ 서점 기본 데이터: {names}")
    except Exception as exc:
        print(f"⚠️ stores 기본 데이터 확인 실패: {exc}")

    return True


# -----------------------------------------------------------------------------
#  [2] 알라딘 구조 덤프
# -----------------------------------------------------------------------------
def clean_html(html: str) -> str:
    """읽기 좋게 정리 — script/style 제거, 공백 축소"""
    html = re.sub(r"<script[\s\S]*?</script>", "", html, flags=re.I)
    html = re.sub(r"<style[\s\S]*?</style>", "", html, flags=re.I)
    html = re.sub(r"<!--[\s\S]*?-->", "", html)
    html = re.sub(r"\s+", " ", html)
    html = re.sub(r">\s*<", ">\n<", html)
    return html.strip()


def probe_aladin() -> None:
    sep("[2] 알라딘 목록 구조 덤프")

    try:
        from selectolax.parser import HTMLParser
    except ImportError:
        print("❌ selectolax 를 불러오지 못했습니다.")
        return

    with PoliteClient(
        user_agent=USER_AGENT,
        delay_min=1.5,
        delay_max=2.5,
        referer="https://www.aladin.co.kr",
    ) as client:
        try:
            resp = client.get(ALADIN_URL)
        except Exception as exc:
            print(f"❌ 요청 실패: {type(exc).__name__}: {exc}")
            return

    html = resp.text
    print(f"✅ HTTP {resp.status_code}, 본문 {len(html):,}자\n")

    tree = HTMLParser(html)

    # 어떤 선택자가 도서 한 칸인지 후보를 비교합니다
    print("컨테이너 후보별 개수:")
    for sel in (".ss_book_box", ".ss_book_list", ".book_Rfloat_02", "#Search3_Result > div"):
        try:
            print(f"  {sel:<22} → {len(tree.css(sel))}개")
        except Exception:
            print(f"  {sel:<22} → (선택자 오류)")

    boxes = tree.css(".ss_book_box")
    if not boxes:
        print("\n❌ .ss_book_box 를 찾지 못했습니다. 구조가 바뀌었을 수 있습니다.")
        return

    print(f"\n>>> .ss_book_box {len(boxes)}개 발견. 앞의 2개를 자세히 뜯어봅니다.\n")

    for idx, box in enumerate(boxes[:2], start=1):
        sep(f"[도서 {idx}] 전체 HTML")
        dumped = clean_html(box.html or "")
        print(dumped[:5000])
        if len(dumped) > 5000:
            print(f"\n... (총 {len(dumped)}자, 이하 생략)")

        sep(f"[도서 {idx}] 링크 목록 (href)")
        seen = set()
        for a in box.css("a"):
            href = (a.attributes.get("href") or "").strip()
            text = " ".join((a.text() or "").split())[:40]
            if href and href not in seen:
                seen.add(href)
                print(f"  {href[:110]}")
                if text:
                    print(f"      텍스트: {text}")

        sep(f"[도서 {idx}] 이미지 (표지 후보)")
        for img in box.css("img"):
            attrs = img.attributes
            for k in ("src", "data-original", "data-src", "data-lazy"):
                v = (attrs.get(k) or "").strip()
                if v:
                    print(f"  {k} = {v[:120]}")

        sep(f"[도서 {idx}] 순수 텍스트")
        text = " ".join((box.text() or "").split())
        print(text[:1200])

        # 판매지수 / ISBN 흔적을 직접 찾아봅니다
        sep(f"[도서 {idx}] 필드 흔적")
        raw = box.html or ""
        for label, pat in [
            ("세일즈포인트", r"세일즈\s*포인트[^0-9]{0,12}([\d,]+)"),
            ("ISBN13", r"\b(97[89][\d]{10})\b"),
            ("ISBN(하이픈)", r"\b(97[89][\d\-]{10,14})\b"),
            ("출간일", r"(20\d{2}\s*년\s*\d{1,2}\s*월(?:\s*\d{1,2}\s*일)?)"),
            ("출간일(점)", r"(20\d{2}[.\-]\d{1,2}[.\-]\d{1,2})"),
            ("상품ID", r"ItemId=(\d+)"),
        ]:
            m = re.search(pat, raw)
            print(f"  {label:<14} {'→ ' + m.group(1) if m else '(못 찾음)'}")

        print()


def main() -> int:
    print("정밀 탐침 시작\n")
    supabase_ok = False
    try:
        supabase_ok = check_supabase()
    except Exception:
        print("Supabase 확인 중 예외:")
        traceback.print_exc()

    try:
        probe_aladin()
    except Exception:
        print("알라딘 탐침 중 예외:")
        traceback.print_exc()

    sep("요약")
    print(f"Supabase 준비 상태: {'✅ 정상' if supabase_ok else '❌ 확인 필요'}")
    # 탐침은 정보 수집이 목적이므로 항상 0으로 끝냅니다 (로그를 남기기 위해)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
