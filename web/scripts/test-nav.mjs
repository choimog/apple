/**
 * 🚨 휴대폰에서 위쪽 메뉴가 눌릴 만큼 넓은지 봅니다.
 *
 * 【2026-08-12 대표님 지적】
 *   "맨 상단에 메뉴가 넘어가는 영역이 모바일에서 보면 너무 좁아.
 *    홈페이지명, 다크모드, 로그인 영역 때문에 말이지."
 *
 * 맞습니다. 한 줄에 넷을 다 넣고 있었습니다.
 *
 *     [📚 베스트셀러 트래커] [메뉴 …………] [🌓] [로그아웃]
 *      ~150px               ← 여기       36    62
 *
 * 휴대폰 폭이 360px 쯤이니 좌우 여백까지 빼면 메뉴에 남는 자리가
 * **100px 도 안 됩니다.** 메뉴가 열 개 가까운데 두세 개밖에 안 보입니다.
 *
 * 그래서 휴대폰에서는 메뉴를 **아랫줄로 내려 폭을 전부** 쓰게 했습니다.
 *
 * ⚠️ 이 시험은 '글자로' 확인합니다. 화면을 실제로 그려 재려면 브라우저가
 *    필요한데, 그건 느리고 잘 깨집니다. 대신 되돌아가면 바로 걸리도록
 *    핵심 규칙만 못박아 둡니다.
 *
 * 실행: node scripts/test-nav.mjs
 * ※ 인터넷도 DB 도 필요 없습니다.
 */

import { readFileSync } from "node:fs";

let bad = 0;
function check(name, ok, got) {
  if (ok) console.log(`  ✅ ${name}`);
  else {
    console.log(
      `  ❌ ${name}${got !== undefined ? `\n       나온 값: ${JSON.stringify(got)}` : ""}`
    );
    bad++;
  }
}

const nav = readFileSync("components/Nav.tsx", "utf8");

console.log("\n[1] 🚨 휴대폰에서 메뉴가 제 줄을 갖는가");
check("휴대폰 전용 메뉴 줄이 있다 (sm 이상에서는 감춤)",
  /sm:hidden/.test(nav),
  "없으면 제목·다크모드·로그아웃과 한 줄을 나눠 써야 합니다");
check("넓은 화면에서는 제목 옆에 붙는다 (휴대폰에서는 감춤)",
  /hidden[^"]*sm:flex/.test(nav));
check("같은 메뉴를 두 번 손으로 적지 않는다 (한 함수로 만듦)",
  /const menu = \(/.test(nav),
  "두 벌로 적으면 한쪽만 고치게 됩니다");

console.log("\n[2] 메뉴가 옆으로 밀려도 다 닿을 수 있는가");
check("가로 스크롤이 켜져 있다", /scroll-x/.test(nav));
check("메뉴 글자가 줄바꿈되지 않는다", /whitespace-nowrap/.test(nav));

console.log("\n[3] 🚨 위쪽이 화면을 너무 많이 먹지 않는가");
// 붙박이(sticky) 머리이므로 두 줄이 되면 그만큼 본문이 가려집니다.
// 그래서 휴대폰에서는 첫 줄을 h-14 → h-12 로 낮췄습니다.
check("휴대폰에서 첫 줄이 더 낮다 (h-12, 넓은 화면은 h-14)",
  /h-12[^"]*sm:h-14/.test(nav),
  "두 줄이 되는 만큼 첫 줄을 낮춰야 합니다");
check("아랫줄도 얇게 (py-1.5)", /py-1\.5[^"]*sm:hidden|sm:hidden[^"]*py-1\.5/.test(nav));

console.log("\n[4] 로그인 전 화면도 같은 높이");
check("로그인 전에도 h-12 / sm:h-14", /h-12 max-w-6xl[^"]*sm:h-14/.test(nav));

console.log("\n[5] 있던 것이 사라지지 않았는가");
for (const label of ["종합", "서점별", "출판사", "저자", "분야", "리포트",
                     "검색", "공유 링크", "수집 상태", "매칭 검토"]) {
  check(`메뉴에 '${label}' 이 그대로 있다`, nav.includes(`"${label}"`));
}
check("로그아웃은 여전히 버튼(POST) 이다",
  /action="\/auth\/signout" method="post"/.test(nav),
  "링크로 두면 남이 보낸 주소를 눌렀을 때 나도 모르게 로그아웃됩니다");
check("다크모드 버튼이 그대로 있다", /<ThemeToggle \/>/.test(nav));

console.log();
if (bad) {
  console.log(`❌ ${bad}개 실패`);
  process.exit(1);
}
console.log("✅ 모두 통과");
