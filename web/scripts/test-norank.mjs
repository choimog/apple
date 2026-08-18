/**
 * 🚨 '순위 밖' 과 '안 묶임' 을 구분해서 적는지 봅니다.
 *
 * 【2026-08-12 대표님 지적】
 *   "종합에서 특정 서점을 '순위 밖' 으로 표시하는데, 이게 묶이지 않은
 *    서점이 있는 경우에도 그 서점을 '순위 밖' 으로 표시하고, 묶인
 *    경우인데 순위에서 빠진 경우 '순위 밖' 이라고 표시하거든?
 *    그래서 가끔 좀 헷갈리는데, 이걸 구분할 수 있나?"
 *
 * 같은 말인데 뜻이 완전히 다릅니다.
 *
 *   묶여 있는데 순위에 없음 → **순위 밖**. 그 서점에서 덜 팔렸다는 뜻.
 *                             = 마케팅 판단에 쓰는 **시장 신호**
 *   아예 안 묶여 있음       → **안 묶임**. 상품을 못 찾았다는 뜻.
 *                             = 그 서점에 없거나, 매칭이 놓쳤거나
 *                             = **자료의 한계** (시장 신호가 아님)
 *
 * 🚨 이 둘을 섞으면 "교보에서 안 팔리는구나" 라고 잘못 읽게 됩니다.
 *    실제로는 교보 상품을 못 찾은 것뿐일 수 있습니다.
 *
 * ⚠️ 그리고 **모를 때는 단정하면 안 됩니다.** 묶인 서점 목록을 아직
 *    못 읽었으면 예전처럼 '순위 밖' 으로 두어야 합니다. 빈 목록을
 *    "어느 서점에도 안 묶임" 으로 읽으면 전부 '안 묶임' 이 됩니다.
 *
 * 실행: node scripts/test-norank.mjs
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

const ui = readFileSync("components/ui.tsx", "utf8");
const row = readFileSync("components/BookRow.tsx", "utf8");
const best = readFileSync("app/best/page.tsx", "utf8");
const detail = readFileSync("app/book/[id]/page.tsx", "utf8");
const queries = readFileSync("lib/queries.ts", "utf8");

console.log("\n[1] 두 가지를 갈라 쓰는 자리가 있는가");
check("NoRank 를 만들어 한 군데서 문구를 정한다",
  /export function NoRank\(/.test(ui),
  "화면마다 따로 적으면 조금씩 달라집니다");
check("'안 묶임' 이라는 말이 있다", /label="안 묶임"/.test(ui));
check("'순위 밖' 도 그대로 남아 있다", /label="순위 밖"/.test(ui));

console.log("\n[2] 🚨 모를 때는 단정하지 않는가");
// linked === false 일 때만 '안 묶임'. null(모름)이면 '순위 밖'.
const noRank = ui.slice(ui.indexOf("export function NoRank("));
const body = noRank.slice(0, noRank.indexOf("\n}\n"));
check("🚨 '안 묶였다' 는 linked 가 명확히 false 일 때만",
  /if \(linked === false\)/.test(body),
  "!linked 로 쓰면 '모름' 까지 '안 묶임' 이 되어 버립니다");
check("모르면 예전처럼 '순위 밖'", body.lastIndexOf('label="순위 밖"') > body.indexOf('label="안 묶임"'));

console.log("\n[3] 🚨 자료를 못 읽었으면 '안 묶임' 으로 몰지 않는가");
check("못 읽었으면 값을 그대로 둔다 (빈 배열로 덮지 않음)",
  /const set = linked\.get\(r\.bookId\);\s*\n\s*if \(set\) r\.linked = \[\.\.\.set\];/.test(queries),
  "빈 배열로 덮으면 '어느 서점에도 안 묶임' 이 되어 버립니다");
check("종합 한 줄도 빈 목록이면 '모름' 으로 넘긴다",
  /row\.linked\?\.length\s*\n?\s*\? row\.linked\.includes\(sid\)\s*\n?\s*: null/.test(row),
  "길이가 0이면 판단하지 않고 null 을 넘겨야 합니다");

console.log("\n[4] 조회를 더 늘리지 않았는가 (느려지면 안 됩니다)");
check("정가와 묶인 서점을 한 번에 읽는다",
  /export async function storeInfoByBook\(/.test(queries));
check("🚨 정가가 없는 줄을 걸러내지 않는다",
  !/\.select\("book_id, store_id, list_price"\)[\s\S]{0,120}\.not\("list_price"/.test(queries),
  "정가만 있는 줄로 좁히면 '정가를 아직 안 걷은 서점' 이 안 묶인 것처럼 보입니다");

console.log("\n[5] 화면 셋이 다 갈라 쓰는가");
check("종합 목록(BookRow)", /<NoRank/.test(row));
check("도서 상세", /<NoRank/.test(detail));
check("도서 상세 — 안 묶인 서점은 이유를 한 줄로 적는다",
  /묶여 있지 않습니다/.test(detail));

console.log("\n[6] 🚨 무슨 뜻인지 화면에 적어 두었는가");
// 말만 바꾸고 설명이 없으면 '안 묶임' 이 새로운 수수께끼가 됩니다.
check("종합 화면에 두 말의 뜻이 적혀 있다",
  /순위 밖<\/strong>/.test(best) && /안 묶임<\/strong>/.test(best),
  "설명이 없으면 대표님이 또 물어보셔야 합니다");
check("'덜 팔렸다는 뜻' 이라고 풀어 준다", /덜\s*\n?\s*팔렸다는 뜻|덜 팔렸다는 뜻/.test(best));

console.log("\n[색] 🚨 두 상태가 색으로도 구분되는가 (2026-08-18 대표님 요청)");
// "안 묶임과 순위 밖은 박스의 색깔을 좀 차이를 둘 수 있나?"
// 글자만 다르면 훑을 때 놓칩니다. 색이 같으면 구분한 보람이 없습니다.
const ui2 = readFileSync("components/ui.tsx", "utf8");
const bookPage = readFileSync("app/book/[id]/page.tsx", "utf8");

check("값 표기에 tone 이 있다", /tone\?: "neutral" \| "gap"/.test(ui2));
check("🚨 '안 묶임' 은 gone 이 아니라 gap 색을 쓴다",
  /label="안 묶임"[\s\S]{0,40}tone="gap"/.test(ui2),
  "이게 빠지면 두 상태가 똑같은 회색이 됩니다");
check("gap 은 앰버, neutral 은 회색", /text-amber-700\/90/.test(ui2) &&
  /text-ink-faint/.test(ui2));
check("'순위 밖' 에는 gap 을 안 붙인다",
  !/label="순위 밖"[\s\S]{0,60}tone="gap"/.test(ui2),
  "순위 밖은 정상이고 완전한 정보입니다. 경고색을 쓰면 안 됩니다");

check("🚨 도서 상세의 박스도 세 상태로 나뉜다",
  /!linked[\s\S]{0,140}border-amber/.test(bookPage),
  "박스 색이 같으면 한눈에 구분이 안 됩니다");
check("안 묶임 박스는 점선 + 앰버", /border-dashed border-amber/.test(bookPage));
check("순위 밖 박스는 점선 + 회색", /border-dashed border-line/.test(bookPage));
check("어두운 화면에서도 색이 정해져 있다",
  /dark:border-amber/.test(bookPage) && /dark:bg-amber/.test(bookPage),
  "어두운 화면에서 밝은 앰버 바탕을 그대로 쓰면 눈이 아픕니다");
check("경고처럼 세게 칠하지 않는다",
  /bg-amber-50\/40/.test(bookPage),
  "대표님 잘못이 아니고, 그 서점에 책이 아예 없어서 그럴 수도 있습니다");

console.log();
if (bad) {
  console.log(`❌ ${bad}개 실패`);
  process.exit(1);
}
console.log("✅ 모두 통과");
