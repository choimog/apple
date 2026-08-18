/**
 * 🚨 휴대폰에서 목록이 깨지지 않는지 봅니다.
 *
 * 【2026-08-18 대표님 지적】
 *   "모바일로 봤을 때, 즐겨찾기 영역에서 판매지수나 순위 부분이 넘치면서
 *    깨져. 사실 이런 부분은 꼭 완전히 엇나가는게 아니더라도 종합이라든지
 *    서점별에서도 특히 모바일 버전에서 가독성이 확 떨어지는 문제가 되긴 해."
 *
 * 실제로 재 봤습니다 (360px · scripts/measure-mobile.mjs).
 *
 *     가로 296px 안에서
 *       순위 44 + 표지 48 + 여백 36 + [빼기] 40  →  3사 칸에 남는 폭 128px
 *       3칸으로 나누면 칸당 42px, 안쪽 여백을 빼면 **속 너비 19px**
 *       판매지수 `1,284,530` 은 62px  →  43px 이 상자 밖으로 삐져나감
 *
 * 숫자에는 띄어쓸 자리가 없어서 줄바꿈도 안 됩니다. 그래서 **자리를 다시
 * 나눴습니다** — 3사 칸을 제목 옆이 아니라 아래 한 줄 전체로 내렸습니다.
 * (글자를 줄여서 맞추면 "안 깨지는데 못 읽는" 화면이 됩니다)
 *
 * 🚨 이 고장은 **넓은 화면에서 아무 표시가 안 납니다.** 노트북으로 보면
 *    멀쩡합니다. 되돌아가도 눈으로는 못 잡습니다.
 *
 * 실행: node scripts/test-mobile.mjs
 * ※ 인터넷도 DB 도 필요 없습니다.
 *   자로 재는 것은 scripts/measure-mobile.mjs (손으로 돌립니다)
 */

import { readFileSync } from "node:fs";

let bad = 0;
function check(name, ok, got) {
  if (ok) console.log(`  ✅ ${name}`);
  else {
    console.log(
      `  ❌ ${name}${got !== undefined ? `\n       ${got}` : ""}`
    );
    bad++;
  }
}

const row = readFileSync("components/BookRow.tsx", "utf8");
const storePage = readFileSync("app/store/page.tsx", "utf8");
const sales = readFileSync("components/SalesPoint.tsx", "utf8");

console.log("\n[1] 🚨 3사 칸이 좁은 자리에 끼어 있지 않은가 (종합·즐겨찾기)");
// 제목 옆에 끼워 넣으면 360px 에서 칸 속이 19px 밖에 안 남습니다.
check("줄이 접힐 수 있다 (flex-wrap)", /<li className="flex flex-wrap/.test(row),
  "안 접히면 칸이 계속 옆으로 밀려 좁아집니다");
check("휴대폰에서 3사 칸이 한 줄을 다 쓴다",
  /grid w-full shrink-0 grid-cols-3/.test(row),
  "w-full 이 빠지면 제목 옆으로 끼어 들어가 다시 깨집니다");
check("넓은 화면에서는 폭을 고정해 오른쪽에 둔다",
  /sm:w-\[\d+rem\]/.test(row));
check("제목 칸이 너무 좁아지지 않게 최소 폭이 있다",
  /min-w-0 flex-1 basis-40/.test(row),
  "basis 가 없으면 제목이 두세 글자씩 끊겨 내려갑니다");
check("칸 안의 것이 상자를 넘지 않게 min-w-0 을 준다",
  /min-w-0 rounded-lg border/.test(row));

console.log("\n[2] 🚨 서점 이름과 순위가 한 줄에 억지로 안 들어가는가");
check("좁으면 두 줄로 나뉜다 (flex-wrap)",
  /flex flex-wrap items-baseline justify-between/.test(row),
  "flex-wrap 이 없으면 좁을 때 글자가 그대로 삐져나갑니다");

console.log("\n[3] 🚨 판매지수 — 숫자는 줄바꿈이 안 됩니다");
check("좁은 칸을 위한 표기를 따로 둔다", /compact/.test(sales));
check("좁은 칸에서는 '판매지수 미제공' 대신 '미제공'",
  /compact \? "미제공" : "판매지수 미제공"/.test(sales),
  "여덟 글자는 좁은 칸에서 접히거나 넘칩니다");
check("좁은 칸에서는 숫자를 한 단계 작게",
  /compact\s*\n?\s*\? "text-xs font-semibold tnum/.test(sales));
check("값을 잘라내지 않는다",
  !/truncate/.test(sales) && !/slice\(/.test(sales),
  "자릿수가 달라지면 딴 숫자가 됩니다");
check("목록 안에서 compact 를 실제로 쓴다", /compact\s*\n?\s*\/>/.test(row));

console.log("\n[4] 🚨 서점별 화면 — 판매지수가 제목 자리를 뺏지 않는가");
// 예전에는 폭 112px 를 늘 차지해서 360px 화면에서 제목에 60px 밖에 안 남았습니다.
check("줄이 접힐 수 있다", /<li\s*\n?\s*key=\{r\.rank\}\s*\n?\s*className="flex flex-wrap/.test(storePage)
  || /className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3"/.test(storePage));
check("휴대폰에서는 판매지수가 아랫줄로 내려간다",
  /w-full shrink-0 pl-\[3\.5rem\] sm:w-28/.test(storePage),
  "w-28 로만 두면 제목에 60px 밖에 안 남습니다");
check("제목 칸에 최소 폭이 있다", /min-w-0 flex-1 basis-40/.test(storePage));

console.log("\n[5] 자로 재는 도구가 남아 있는가");
const measure = readFileSync("scripts/measure-mobile.mjs", "utf8");
check("측정 도구가 있다", measure.includes("scrollWidth"));
check("여러 폭을 본다", /320, 360, 390, 430, 768, 1024, 1280/.test(measure));
check("없으면 조용히 건너뛴다", /playwright 가 없어 건너뜁니다/.test(measure),
  "자동 확인이 이것 때문에 실패하면 안 됩니다");

console.log();
if (bad) {
  console.log(`❌ ${bad}개 실패`);
  process.exit(1);
}
console.log("✅ 모두 통과");
