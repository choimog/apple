import type { Metadata, Viewport } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: {
    default: "서점 베스트셀러 트래커",
    template: "%s · 베스트셀러 트래커",
  },
  description:
    "교보문고·예스24·알라딘 베스트셀러를 매일 모아 3사 순위를 비교하고, 출판사·저자·분야별 흐름을 봅니다.",
};

// 주소창 색 (Next.js 는 themeColor 를 viewport 로 옮기라고 안내합니다)
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0a09" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen">
        {/* 키보드만 쓰는 분이 메뉴를 건너뛰고 본문으로 갈 수 있게 */}
        <a href="#main" className="sr-only skip-link">
          본문으로 건너뛰기
        </a>

        <Nav />

        <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
          {children}
        </main>

        <footer className="mx-auto max-w-6xl px-4 pb-12 pt-4">
          <div className="rounded-2xl border border-line bg-surface px-4 py-4 text-xs leading-relaxed text-ink-faint sm:px-5">
            <p>
              매일 한국시간 오전 6시에 각 서점의{" "}
              <strong className="text-ink-soft">베스트셀러 목록 페이지</strong>에서
              공개된 정보만 수집합니다. 도서 상세 페이지에는 들어가지 않습니다.
            </p>
            <p className="mt-1.5">
              표지 이미지는 저장하지 않고 각 서점의 주소를 그대로 불러옵니다.
              순위·판매지수 등 모든 수치의 저작권은 각 서점에 있습니다.
            </p>
            <p className="mt-1.5">
              <strong className="text-ink-soft">값이 없으면 없다고 표시합니다.</strong>{" "}
              빈 칸을 추정해서 채우지 않고, 수집이 실패한 날은 실패로 남깁니다.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
