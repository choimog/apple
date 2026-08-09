import type { Metadata, Viewport } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import StaleWarning from "@/components/StaleWarning";
import { THEME_BOOT } from "@/components/ThemeToggle";
import { getSnapshotDates } from "@/lib/queries";
import { staleness } from "@/lib/stale";
import { me } from "@/lib/supabase";

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  /**
   * 로그인한 사람. 못 읽어도 화면은 떠야 합니다 —
   * 접속 정보가 없을 때 로그인 화면 자체가 안 뜨면 안내조차 못 합니다.
   */
  let who: { email: string | null; role: "admin" | "viewer" | null } = {
    email: null,
    role: null,
  };
  try {
    who = await me();
  } catch {
    /* 못 읽어도 로그인 화면은 떠야 합니다 */
  }

  /**
   * "며칠째 새 자료가 안 들어왔나" — 모든 화면 위에 띄웁니다.
   *
   * 【왜 홈이 아니라 여기(모든 화면)인가요?】
   * 이건 '수집이 통째로 멈춘 것' 을 알리는 마지막 안전장치입니다.
   * 홈에만 두면, 즐겨찾기로 [서점별 순위] 만 보시는 날에는 못 봅니다.
   *
   * ⚠️ 로그인한 분에게만 봅니다. 로그인 전에는 보안 규칙 때문에 순위를
   *    못 읽는데, 그걸 '자료가 없다' 로 읽으면 **멀쩡한데도 빨간 경고가**
   *    뜹니다. 공유 링크(/s/…)를 받은 분에게도 마찬가지입니다.
   *
   * ⚠️ 못 읽었을 때도 안 띄웁니다. '못 읽음' 과 '오래됨' 은 다릅니다.
   */
  let latest: string | null = null;
  if (who.email) {
    try {
      latest = (await getSnapshotDates(1))[0] ?? null;
    } catch {
      latest = null; // 못 읽었으면 판단하지 않습니다
    }
  }
  const stale = staleness(latest);

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

        <Nav email={who.email} isAdmin={who.role === "admin"} />

        <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
          {stale && latest && <StaleWarning info={stale} latest={latest} />}
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
