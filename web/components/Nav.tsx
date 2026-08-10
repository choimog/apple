"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";

/**
 * 위쪽 메뉴.
 *
 * 【2026-08-08 대표님 지적】
 * "순위, 분석 표시는 없앨 것, 메뉴는 카테고리마다 더 분명히 구분되도록."
 *
 * 【2026-08-09 대표님 요청】
 * "종합 순위, 서점별 순위를 종합, 서점별로 나눠주고
 *  상단 메뉴의 구분이 더 잘가도록 디자인을 좀 추가해줬으면 좋겠어."
 *
 * 한 일
 *  1. '종합 순위' → '종합', '서점별 순위' → '서점별' 로 줄였습니다.
 *     짧아진 만큼 휴대폰에서 한 줄에 더 들어갑니다.
 *  2. 묶음마다 **옅은 상자**로 감쌌습니다. 예전에는 얇은 세로선 하나뿐이라
 *     어디까지가 한 묶음인지 눈으로 세어야 했습니다.
 *  3. 지금 보고 있는 곳은 색을 채우고 그림자를 얹어 더 또렷하게 했습니다.
 *
 * ⚠️ '순위'·'분석' 같은 **글자 머리표는 일부러 다시 넣지 않았습니다.**
 *    2026-08-08 에 없애라고 하신 것입니다. 구분은 글자 대신 상자로 냅니다.
 *    (글자가 있는 편이 낫다고 하시면 name 을 화면에 그리면 됩니다)
 */
type Group = { name: string; items: { href: string; label: string }[] };

const GROUPS: Group[] = [
  {
    name: "순위",
    items: [
      { href: "/best", label: "종합" },
      { href: "/store", label: "서점별" },
    ],
  },
  {
    name: "분석",
    items: [
      { href: "/publishers", label: "출판사" },
      { href: "/authors", label: "저자" },
      { href: "/insights", label: "분야" },
    ],
  },
  {
    name: "그 외",
    items: [
      { href: "/report", label: "리포트" },
      { href: "/search", label: "검색" },
      { href: "/status", label: "수집 상태" },
    ],
  },
];

/** 관리자에게만 보이는 메뉴 */
const ADMIN_GROUP: Group = {
  name: "관리",
  items: [
    { href: "/review", label: "매칭 검토" },
    { href: "/share", label: "공유 링크" },
  ],
};

export default function Nav({
  email,
  isAdmin,
}: {
  email: string | null;
  isAdmin: boolean;
}) {
  const path = usePathname();

  /**
   * 로그인 전에는 메뉴를 감춥니다.
   * 눌러도 어차피 로그인 화면으로 되돌아오므로, 보여줄 이유가 없습니다.
   */
  if (!email) {
    return (
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <span className="text-[15px] font-bold tracking-[-0.01em]">
            <span aria-hidden>📚</span> 베스트셀러 트래커
          </span>
          <ThemeToggle />
        </div>
      </header>
    );
  }

  // 관리자에게만 [관리] 묶음을 붙입니다.
  // 보기 전용 회원에게 보여봐야 눌러도 "권한이 없습니다" 만 뜹니다.
  const groups: Group[] = isAdmin ? [...GROUPS, ADMIN_GROUP] : GROUPS;

  const isOn = (href: string) => {
    if (href === "/best") return path === "/best";
    if (href === "/store") return path === "/store";
    if (href === "/publishers") return path.startsWith("/publisher");
    if (href === "/authors") return path.startsWith("/author");
    return path.startsWith(href);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex h-14 items-center gap-4">
          <Link
            href="/"
            className={`shrink-0 text-[15px] font-bold tracking-[-0.01em] ${
              path === "/" ? "text-ink" : "text-ink-soft hover:text-ink"
            }`}
          >
            <span aria-hidden>📚</span> 베스트셀러 트래커
          </Link>

          {/*
            묶음을 옅은 상자로 감싸 경계를 냅니다.
            (글자 머리표는 대표님이 2026-08-08 에 없애라고 하셔서 안 씁니다.
             name 은 화면에 안 그리고 구분·읽어주기 용도로만 씁니다)
          */}
          <nav
            aria-label="주요 메뉴"
            className="scroll-x flex min-w-0 flex-1 items-center gap-2.5"
          >
            {groups.map((g) => (
              <div
                key={g.name}
                role="group"
                aria-label={g.name}
                className="flex shrink-0 items-center gap-1 rounded-xl border border-line-soft bg-surface-2/60 px-1 py-1"
              >
                {g.items.map((it) => {
                  const on = isOn(it.href);
                  return (
                    <Link
                      key={it.href}
                      href={it.href}
                      aria-current={on ? "page" : undefined}
                      className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-sm transition-colors ${
                        on
                          ? "bg-accent font-semibold text-accent-ink shadow-sm"
                          : "text-ink-soft hover:bg-surface hover:text-ink"
                      }`}
                    >
                      {it.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <ThemeToggle />

          {/*
            로그아웃은 링크가 아니라 버튼입니다.
            링크로 두면 남이 보낸 주소를 눌렀을 때 나도 모르게 로그아웃됩니다.
          */}
          <form action="/auth/signout" method="post" className="shrink-0">
            <button
              type="submit"
              title={email}
              className="rounded-lg px-2.5 py-1.5 text-sm text-ink-soft hover:bg-surface-2 hover:text-ink"
            >
              로그아웃
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
