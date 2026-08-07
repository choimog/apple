import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "서점 베스트셀러 트래커",
  description: "교보문고·예스24·알라딘 베스트셀러를 매일 모아서 비교합니다.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="text-lg font-bold">
              📚 서점 베스트셀러 트래커
            </Link>
            <nav className="flex gap-4 text-sm text-slate-600">
              <Link href="/" className="hover:text-slate-900 hover:underline">
                종합 순위
              </Link>
              <Link href="/store" className="hover:text-slate-900 hover:underline">
                서점별 순위
              </Link>
              <Link href="/search" className="hover:text-slate-900 hover:underline">
                도서 검색
              </Link>
              <Link href="/status" className="hover:text-slate-900 hover:underline">
                수집 상태
              </Link>
            </nav>
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
        </footer>
      </body>
    </html>
  );
}
