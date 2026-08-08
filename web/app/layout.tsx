import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "서점 베스트셀러 트래커",
  description: "교보문고·예스24·알라딘 베스트셀러를 매일 모아서 비교합니다.",
};

/**
 * 위쪽 메뉴.
 *
 * 【두 덩어리로 나눈 이유 — 2026-08-08 대표님 지적】
 * "종합과 세부 분야에 대한 구분이 잘 안 된다."
 * 예전에는 '순위표' 하나에 3사 평균과 서점별 순위가 섞여 있었습니다.
 * 이제 성격이 다른 둘을 눈에 보이게 갈라 놓았습니다.
 *
 *   순위 : 무엇이 잘 팔리나 (종합 / 서점별)
 *   분석 : 누가·어느 분야가 잘 하나 (출판사 / 저자 / 분야)
 */
const NAV = [
  {
    group: "순위",
    items: [
      { href: "/best", label: "종합 순위", desc: "3사 평균" },
      { href: "/store", label: "서점별 순위", desc: "교보·예스24·알라딘" },
    ],
  },
  {
    group: "분석",
    items: [
      { href: "/publishers", label: "출판사" },
      { href: "/authors", label: "저자" },
      { href: "/insights", label: "분야 분석" },
    ],
  },
  {
    group: "기타",
    items: [
      { href: "/search", label: "도서 검색" },
      { href: "/status", label: "수집 상태" },
    ],
  },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto max-w-6xl px-4">
            <div className="flex h-14 items-center gap-6">
              <Link
                href="/"
                className="shrink-0 text-[15px] font-bold tracking-tight"
              >
                📚 베스트셀러 트래커
              </Link>
              <nav className="scroll-x flex items-center gap-5 text-sm">
                {NAV.map((g) => (
                  <div key={g.group} className="flex items-center gap-3">
                    <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-slate-300 sm:inline">
                      {g.group}
                    </span>
                    {g.items.map((it) => (
                      <Link
                        key={it.href}
                        href={it.href}
                        className="whitespace-nowrap text-slate-600 transition-colors hover:text-slate-900"
                      >
                        {it.label}
                      </Link>
                    ))}
                  </div>
                ))}
              </nav>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>

        <footer className="mx-auto max-w-6xl px-4 py-10 text-xs leading-relaxed text-slate-500">
          <p>
            매일 한국시간 오전 6시에 각 서점의 <strong>베스트셀러 목록 페이지</strong>
            에서 공개된 정보만 수집합니다. 도서 상세 페이지에는 들어가지 않습니다.
          </p>
          <p className="mt-1">
            표지 이미지는 저장하지 않고 각 서점의 주소를 그대로 불러옵니다.
            순위·판매지수 등 모든 수치의 저작권은 각 서점에 있습니다.
          </p>
          <p className="mt-1">
            값이 없으면 없다고 표시합니다. 빈 칸을 추정해서 채우지 않습니다.
          </p>
        </footer>
      </body>
    </html>
  );
}
