"""
=============================================================================
 정찰(recon) 스크립트 — Phase 1.5
=============================================================================

 【무엇을 하나요?】
 크롤러를 만들기 "전에", 서점 3사에 대해 다음 4가지를 실제로 확인합니다.
 (요구사항 3-3-1)

   1. 목록 페이지에서 실제로 뽑히는 필드가 무엇인가
   2. 단순 요청으로 되는가, 브라우저 자동화가 필요한가
   3. 클라우드 서버 IP가 차단당하는가
   4. 표지 이미지 핫링크가 되는가

 추가로 robots.txt 를 읽어서 허용 범위를 확인합니다.

 【어떻게 실행하나요?】
 GitHub 저장소 → [Actions] 탭 → 왼쪽에서 "3사 정찰(recon)" 클릭
 → 오른쪽 [Run workflow] 버튼 클릭 → 잠시 뒤 결과 확인

 【결과는 어디서 보나요?】
 실행이 끝나면 그 실행 화면 아래 [Artifacts] 에서 recon-report 를 내려받으세요.
 - report.md      : 사람이 읽는 요약 보고서
 - raw/*.html     : 실제 응답 원본 (선택자를 만들 때 씁니다)
 - raw/*.txt      : robots.txt 원본

 ※ 이 스크립트는 데이터를 저장하지 않습니다. 오직 확인만 합니다.
 ※ 서점당 요청 수는 10건 내외로 제한됩니다.
=============================================================================
"""

from __future__ import annotations

import re
import sys
import traceback
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import robots as robots_parser  # noqa: E402
from common.http import BlockedError, PoliteClient  # noqa: E402


OUT_DIR = Path(__file__).resolve().parent.parent / "recon_out"
RAW_DIR = OUT_DIR / "raw"

USER_AGENT = "BestsellerTracker/1.0 (+https://github.com/choimog/apple)"


# -----------------------------------------------------------------------------
#  정찰 대상: 서점별로 "목록 페이지 1개"만 확인합니다 (상세 페이지 진입 금지)
# -----------------------------------------------------------------------------
@dataclass
class Target:
    key: str
    name: str
    origin: str
    sample_url: str          # 대표 목록 페이지 1개
    extra_urls: dict         # 추가로 확인할 목록 페이지 (분야 코드 탐색용)


TARGETS = [
    Target(
        key="kyobo",
        name="교보문고",
        origin="https://store.kyobobook.co.kr",
        sample_url="https://store.kyobobook.co.kr/bestseller/online/weekly/domestic?page=1",
        extra_urls={
            "오프라인_광화문점": "https://store.kyobobook.co.kr/bestseller/store/seoul/001/00?page=1&per=50",
        },
    ),
    Target(
        key="yes24",
        name="예스24",
        origin="https://www.yes24.com",
        sample_url="https://www.yes24.com/product/category/bestseller?categoryNumber=001&pageNumber=1&pageSize=24",
        extra_urls={
            # pageSize 를 키울 수 있는지 확인 → 가능하면 요청 수가 크게 줄어듭니다
            "pageSize_120_시도": "https://www.yes24.com/product/category/bestseller?categoryNumber=001&pageNumber=1&pageSize=120",
        },
    ),
    Target(
        key="aladin",
        name="알라딘",
        origin="https://www.aladin.co.kr",
        sample_url="https://www.aladin.co.kr/shop/common/wbest.aspx?BranchType=1&BestType=Bestseller&page=1",
        extra_urls={},
    ),
]


# -----------------------------------------------------------------------------
#  필드 탐지 — 목록 HTML 안에 각 정보가 있는지 흔적을 찾습니다
# -----------------------------------------------------------------------------
FIELD_PROBES: dict[str, list[str]] = {
    "판매지수/세일즈포인트": [r"판매지수", r"세일즈\s*포인트", r"SalesPoint", r"sales_?point"],
    "출간일": [r"20\d{2}[.\-/]\s?\d{1,2}[.\-/]\s?\d{1,2}", r"20\d{2}년\s?\d{1,2}월"],
    "ISBN": [r"\b97[89][\-\d]{10,14}\b", r"isbn", r"ISBN"],
    "출판사": [r"출판사", r"publisher", r"pub_?nm"],
    "저자": [r"저자", r"지은이", r"작가", r"author"],
    "해시태그": [r"#\w", r"해시태그", r"hashtag"],
    "이벤트": [r"이벤트", r"굿즈", r"사은품", r"event"],
}

# 표지 이미지로 보이는 주소 패턴
# ※ 1차 정찰에서 로고/배너를 표지로 잘못 잡았습니다. 그래서 아래 두 단계로 거릅니다.
COVER_PATTERNS = [
    # 알라딘: /product/.../cover... 또는 coversum
    r'https?://image\.aladin\.co\.kr/[^"\'\s]*(?:product|cover)[^"\'\s]*\.(?:jpg|jpeg|png|gif)',
    # 예스24: /goods/<상품번호>/ 형태
    r'https?://image\.yes24\.com/goods/[^"\'\s]+\.(?:jpg|jpeg|png|gif)',
    # 교보: 상품 이미지 경로
    r'https?://contents\.kyobobook\.co\.kr/[^"\'\s]*(?:pdt|sih)[^"\'\s]*\.(?:jpg|jpeg|png|gif)',
]

# 이 단어가 주소에 들어 있으면 표지가 아니라 로고/배너/아이콘입니다
NOT_A_COVER = (
    "logo", "banner", "icon", "favicon", "header", "footer",
    "gnb", "sysimage", "common", "btn", "bg_", "sprite", "blank",
)


def probe_fields(html: str) -> dict[str, bool]:
    """HTML 안에 각 필드의 흔적이 있는지 확인합니다. (있음/없음만 판단)"""
    found = {}
    for field_name, patterns in FIELD_PROBES.items():
        found[field_name] = any(re.search(p, html, re.IGNORECASE) for p in patterns)
    return found


def find_cover_urls(html: str, limit: int = 5) -> list[str]:
    """
    HTML 안에서 '실제 책 표지' 주소를 찾습니다.
    로고·배너·아이콘은 걸러냅니다. (1차 정찰에서 로고를 표지로 오인한 버그 수정)
    """
    urls: list[str] = []
    for pattern in COVER_PATTERNS:
        for m in re.finditer(pattern, html, re.IGNORECASE):
            u = m.group(0)
            low = u.lower()
            if any(bad in low for bad in NOT_A_COVER):
                continue
            if u not in urls:
                urls.append(u)
            if len(urls) >= limit:
                return urls
    return urls


def looks_js_rendered(html: str) -> tuple[bool, str]:
    """
    이 페이지가 자바스크립트로 그려지는지 추정합니다.
    (본문에 책 제목 같은 실제 데이터가 없고 빈 껍데기만 있으면 JS 렌더링)
    """
    # 한글이 거의 없으면 데이터가 안 실려 있는 것
    hangul_count = len(re.findall(r"[가-힣]", html))
    if hangul_count < 100:
        return True, f"본문에 한글이 {hangul_count}자뿐 — 데이터가 안 실려 있음"

    # __NEXT_DATA__ / window.__NUXT__ 같은 JSON 데이터가 있으면
    # 정적으로 파싱 가능 (오히려 좋음)
    if "__NEXT_DATA__" in html or "__NUXT__" in html:
        return False, "페이지 안에 JSON 데이터가 포함되어 있음 (정적 파싱 가능)"

    return False, f"정적 HTML에 한글 {hangul_count}자 포함 — 파싱 가능해 보임"


def deep_structure_probe(html: str) -> list[str]:
    """
    목록 데이터가 정말 HTML 안에 들어 있는지 구조를 직접 확인합니다.
    (1차 정찰에서 교보만 '항목 0개'로 나와 판단이 애매했던 부분)
    """
    notes: list[str] = []

    # 실제 책 제목처럼 보이는 링크의 개수
    for label, pat in [
        ("상품 링크(detail/goods)", r'href="[^"]*(?:detail|goods|Product)[^"]*"'),
        ("li 태그", r"<li[\s>]"),
        ("이미지 alt 속성", r'alt="[^"]{4,}"'),
        ("data-* 속성", r"data-[a-z-]+="),
    ]:
        n = len(re.findall(pat, html, re.IGNORECASE))
        notes.append(f"{label}: {n}개")

    # 페이지 안에 JSON 덩어리가 있는지 (있으면 그걸 파싱하는 게 더 안전)
    for label, pat in [
        ("__NEXT_DATA__", r"__NEXT_DATA__"),
        ("window.__NUXT__", r"__NUXT__"),
        ("application/ld+json", r'type="application/ld\+json"'),
    ]:
        if re.search(pat, html):
            notes.append(f"✔ {label} 발견 — JSON 파싱 가능")

    # 흔한 목록 컨테이너 class 이름을 실제로 찾아봅니다
    classes = re.findall(r'class="([^"]{3,60})"', html)
    from collections import Counter

    common = Counter(
        c.strip() for c in classes
        if any(k in c.lower() for k in ("prod", "item", "book", "list", "rank"))
    ).most_common(8)
    if common:
        notes.append("자주 나오는 목록 관련 class: " +
                     ", ".join(f"`{c}`×{n}" for c, n in common))
    else:
        notes.append("⚠️ 목록 관련 class 이름을 찾지 못함 — JS 렌더링 의심")

    return notes


def count_list_items(html: str) -> int:
    """목록에 항목이 몇 개쯤 있는지 대략 셉니다 (순위 숫자 패턴 기준)."""
    # 흔한 순위 표기들
    candidates = [
        len(re.findall(r'class="[^"]*rank[^"]*"', html, re.IGNORECASE)),
        len(re.findall(r'class="[^"]*prod_?item[^"]*"', html, re.IGNORECASE)),
        len(re.findall(r'class="[^"]*ss_book_box[^"]*"', html, re.IGNORECASE)),
        len(re.findall(r'class="[^"]*itemList[^"]*"', html, re.IGNORECASE)),
    ]
    return max(candidates) if candidates else 0


# -----------------------------------------------------------------------------
#  개별 검사 함수들
# -----------------------------------------------------------------------------
def check_robots(client: PoliteClient, target: Target, report: list[str]) -> None:
    """robots.txt 를 읽고 우리가 수집할 경로가 허용되는지 확인합니다."""
    url = urljoin(target.origin, "/robots.txt")
    report.append(f"### robots.txt — {target.name}\n")
    try:
        # robots.txt 안에는 'robot' 이라는 단어가 당연히 들어 있으므로
        # 차단 문구 검사를 꺼야 합니다. (1차 정찰에서 알라딘을 못 읽은 원인)
        resp = client.get(
            url,
            allow_status=(404,),
            check_block_markers=False,
            min_body_len=1,
        )
    except Exception as exc:
        report.append(f"- ❌ 읽기 실패: `{type(exc).__name__}: {exc}`\n")
        return

    if resp.status_code == 404:
        report.append("- ℹ️ robots.txt 가 없습니다 (404). 명시적 금지 없음.\n")
        return

    text = resp.text
    (RAW_DIR / f"{target.key}_robots.txt").write_text(text, encoding="utf-8")
    report.append(f"- 상태: HTTP {resp.status_code}, {len(text)}자")
    report.append(f"- 원본 저장: `raw/{target.key}_robots.txt` (전문)\n")

    rules = robots_parser.parse(text)
    group = rules.group_for(USER_AGENT)

    # 우리에게 적용되는 그룹만 보여줍니다 (파일 전체를 쏟아내지 않음)
    if group is None:
        report.append("- 우리에게 적용되는 규칙 그룹이 없습니다 → 전체 허용\n")
    else:
        report.append(
            f"- 우리 User-Agent 에 적용되는 그룹: **`User-Agent: "
            f"{', '.join(group.agents)}`**"
        )
        report.append(f"  - 그룹 내 Allow {len(group.allows)}개 / "
                      f"Disallow {len(group.disallows)}개")
        report.append("")
        report.append("```")
        for a in group.allows:
            report.append(f"Allow: {a}")
        for d in group.disallows:
            report.append(f"Disallow: {d}")
        report.append("```\n")

    report.append(f"- 파일 전체 그룹 수: {len(rules.groups)}개 "
                  f"(다른 그룹은 우리와 무관하므로 무시)\n")

    # 실제로 수집할 모든 URL 을 하나씩 판정합니다
    check_urls = [("대표 목록", target.sample_url)] + list(target.extra_urls.items())
    report.append("| 수집 대상 경로 | 판정 | 근거 |")
    report.append("|---|---|---|")
    blocked_any = False
    for label, u in check_urls:
        allowed, why = rules.is_allowed(u, USER_AGENT)
        if not allowed:
            blocked_any = True
        path = urlparse(u).path
        report.append(
            f"| {label} `{path}` | {'✅ 허용' if allowed else '🚫 **금지**'} | {why} |"
        )
    report.append("")

    if blocked_any:
        report.append(
            "- 🚨 **금지된 경로가 있습니다. 임의로 우회하지 않습니다.** "
            "사용자에게 보고 후 판단이 필요합니다.\n"
        )
    else:
        report.append("- ✅ 수집 예정 경로는 모두 허용 범위 안입니다.\n")


def check_listing(
    client: PoliteClient, target: Target, label: str, url: str, report: list[str]
) -> dict:
    """목록 페이지 1개를 가져와서 필드·렌더링 방식·차단 여부를 확인합니다."""
    report.append(f"### 목록 페이지 확인 — {target.name} / {label}\n")
    report.append(f"- URL: `{url}`\n")

    result: dict = {"ok": False, "covers": []}

    try:
        resp = client.get(url)
    except BlockedError as exc:
        report.append(f"- 🚨 **차단 의심**: {exc}\n")
        report.append(
            "  → 클라우드 IP 차단 가능성. 대응안 검토가 필요합니다.\n"
        )
        result["blocked"] = True
        return result
    except Exception as exc:
        report.append(f"- ❌ 실패: `{type(exc).__name__}: {exc}`\n")
        return result

    html = resp.text
    safe_label = re.sub(r"[^\w]+", "_", label)
    raw_path = RAW_DIR / f"{target.key}_{safe_label}.html"
    raw_path.write_text(html, encoding="utf-8")

    report.append(f"- ✅ HTTP {resp.status_code}, 본문 {len(html):,}자")
    report.append(f"- 원본 저장: `raw/{raw_path.name}` (선택자 작성에 사용)")

    js, why = looks_js_rendered(html)
    icon = "🟡" if js else "🟢"
    report.append(f"- {icon} 렌더링 방식: {why}")

    n_items = count_list_items(html)
    report.append(f"- 목록 항목 추정 개수: 약 {n_items}개")
    report.append("- 구조 상세 확인:")
    for note in deep_structure_probe(html):
        report.append(f"  - {note}")

    fields = probe_fields(html)
    report.append("\n| 필드 | 목록에 있음? |")
    report.append("|---|---|")
    for name, present in fields.items():
        report.append(f"| {name} | {'✅ 있음' if present else '❌ 없음'} |")
    report.append("")

    covers = find_cover_urls(html)
    if covers:
        report.append(f"- 표지 주소 예시 ({len(covers)}개 발견):")
        for c in covers[:3]:
            report.append(f"  - `{c}`")
    else:
        report.append("- ⚠️ 표지 이미지 주소를 찾지 못했습니다.")
    report.append("")

    result.update({"ok": True, "covers": covers, "js": js, "fields": fields})
    return result


def check_hotlink(cover_url: str, report: list[str]) -> None:
    """
    표지 이미지를 '다른 사이트에서 불러오는 것처럼' 요청해서
    핫링크 차단 여부를 확인합니다. (요구사항 3-2-1)
    """
    report.append("### 표지 이미지 핫링크 확인\n")
    report.append(f"- 대상: `{cover_url}`\n")

    # 우리 사이트에서 불러오는 상황을 흉내: Referer 를 우리 도메인으로
    fake_referer = "https://bestseller-tracker.vercel.app/"

    for label, headers in [
        ("Referer 없음 (직접 접근)", {"User-Agent": USER_AGENT}),
        (
            f"Referer = 우리 사이트",
            {"User-Agent": USER_AGENT, "Referer": fake_referer},
        ),
    ]:
        try:
            with httpx.Client(timeout=15, follow_redirects=True) as c:
                r = c.get(cover_url, headers=headers)
            ctype = r.headers.get("content-type", "")
            size = len(r.content)
            ok = r.status_code == 200 and ctype.startswith("image/") and size > 1000
            icon = "✅" if ok else "🚨"
            report.append(
                f"- {icon} {label}: HTTP {r.status_code}, "
                f"{ctype or '(타입없음)'}, {size:,} bytes"
            )
        except Exception as exc:
            report.append(f"- ❌ {label}: `{type(exc).__name__}: {exc}`")

    report.append(
        "\n> 두 줄 모두 ✅ 면 핫링크가 정상 동작합니다.\n"
        "> 🚨 가 있으면 서점이 외부 참조를 막는 것이므로 대안 논의가 필요합니다.\n"
    )


# -----------------------------------------------------------------------------
#  메인
# -----------------------------------------------------------------------------
def main() -> int:
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    report: list[str] = [
        "# 서점 3사 정찰 보고서",
        "",
        "이 보고서는 **GitHub Actions 클라우드 서버에서 실제로 실행**된 결과입니다.",
        "즉, 앞으로 매일 수집이 돌아갈 바로 그 환경에서 확인한 것입니다.",
        "",
        "확인 항목 (요구사항 3-3-1):",
        "1. 목록 페이지에서 실제로 뽑히는 필드",
        "2. 정적 HTML vs 자바스크립트 렌더링",
        "3. 클라우드 IP 차단 여부",
        "4. 표지 핫링크 정상 표시 여부",
        "",
        "---",
        "",
    ]

    all_covers: dict[str, list[str]] = {}
    summary_rows: list[str] = []

    for target in TARGETS:
        report.append(f"## {target.name}")
        report.append("")

        with PoliteClient(
            user_agent=USER_AGENT,
            delay_min=1.5,
            delay_max=2.5,
            referer=target.origin,
        ) as client:
            try:
                check_robots(client, target, report)

                res = check_listing(
                    client, target, "대표 목록", target.sample_url, report
                )
                if res.get("covers"):
                    all_covers[target.key] = res["covers"]

                for label, url in target.extra_urls.items():
                    check_listing(client, target, label, url, report)

                # 요약 행
                if res.get("blocked"):
                    status = "🚨 차단 의심"
                elif res.get("ok"):
                    status = "🟡 JS 렌더링 필요" if res.get("js") else "🟢 정적 파싱 가능"
                else:
                    status = "❌ 실패"
                summary_rows.append(
                    f"| {target.name} | {status} | "
                    f"{client.stats.requests}건 | "
                    f"{client.stats.elapsed_sec:.1f}초 |"
                )

            except Exception:
                report.append("```")
                report.append(traceback.format_exc())
                report.append("```")
                summary_rows.append(f"| {target.name} | ❌ 예외 발생 | - | - |")

        report.append("")
        report.append("---")
        report.append("")

    # 핫링크는 알라딘 우선 (요구사항 3-2-1: 알라딘 표지가 1순위)
    report.append("## 표지 핫링크 검증")
    report.append("")
    for key in ("aladin", "yes24", "kyobo"):
        if all_covers.get(key):
            check_hotlink(all_covers[key][0], report)
            break
    else:
        report.append("⚠️ 표지 주소를 하나도 못 찾아서 핫링크 확인을 건너뜁니다.\n")

    # 맨 앞에 요약표 삽입
    summary = [
        "## 한눈에 보기",
        "",
        "| 서점 | 상태 | 요청 수 | 소요 시간 |",
        "|---|---|---|---|",
        *summary_rows,
        "",
        "---",
        "",
    ]
    report[10:10] = summary

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "report.md"
    out_path.write_text("\n".join(report), encoding="utf-8")

    print("\n".join(report))
    print(f"\n\n>>> 보고서 저장 위치: {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
