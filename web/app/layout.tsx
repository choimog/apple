import type { Metadata, Viewport } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import { THEME_BOOT } from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: {
    default: "서점 베스트셀러 트래커",
    template: "%s · 베스트셀러 트래커",
  },
  description:
    "교보문고·예스24·알라딘 베스트셀러를 매일 모아 3사 순위를 비교하고, 출판사·저자·분야별 흐름을 봅니다.",
};

// 주소창 색. 기본이 밝은 화면이므로 밝은 색 하나만 씁니다.
export const viewport: Viewport = { themeColor: "#faf9f7" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/*
          저장해 둔 화면 설정을 그리기 전에 먼저 적용합니다.
          이게 없으면 어두운 화면을 쓰는 분에게 흰 화면이 한 번 번쩍입니다.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-screen">
        {/* 키보드만 쓰는 분이 메뉴를 건너뛰고 본문으로 갈 수 있게 */}
        <a href="#main" className="sr-only skip-link">
          본문으로 건너뛰기
        </a>

        <Nav />

        <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
          {children}
        </main>

        <footer className="mx-auto max-w-6xl px-4 pb-10 pt-6">
          <p className="text-xs text-ink-faint">
            순위·판매지수의 저작권은 각 서점에 있습니다.
          </p>
        </footer>
      </body>
    </html>
  );
}
