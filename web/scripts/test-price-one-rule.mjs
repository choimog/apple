/**
 * 🚨 정가를 정하는 규칙이 화면마다 다르지 않은지 봅니다.
 *
 * 【2026-08-12 대표님 신고】
 *   "저걸 하나로 묶었더니 검색해서 나오는 목록에서는 가격이 12,500원으로
 *    나오고, 도서를 클릭해서 나오는 페이지에는 15,000원으로 나오는
 *    문제가 발생했어."
 *
 * 규칙이 **두 벌**이었습니다.
 *   · 목록·검색  → 가장 많이 나온 값        (12,500 이 2표)
 *   · 도서 상세  → 표지를 준 서점(알라딘) 값 (15,000)
 *
 * 같은 책인데 화면마다 다른 값이 나오면 **어느 쪽도 못 믿게 됩니다.**
 * 이제 세 화면이 priceOf() 하나를 씁니다.
 *
 * 실행: node scripts/test-price-one-rule.mjs
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

/* priceOf 를 그대로 옮겨 온 것이 아니라, queries.ts 의 규칙을 흉내 낸
   값으로 결과만 확인합니다 (queries.ts 는 supabase 를 불러와 못 가져옵니다) */
function priceOf(list) {
  const votes = new Map();
  for (const v of list) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    votes.set(v, (votes.get(v) ?? 0) + 1);
  }
  let best = null, bestN = 0, tied = false;
  for (const [price, n] of votes) {
    if (n > bestN) { best = price; bestN = n; tied = false; }
    else if (n === bestN) tied = true;
  }
  let known = 0;
  for (const n of votes.values()) known += n;
  return { value: tied ? null : best, split: votes.size > 1, known };
}

console.log("\n[1] 🚨 『긴긴밤』 그대로 — 목록과 상세가 같은 값이어야 합니다");
// 예스24 12,500 · 교보 12,500 · 알라딘 15,000 (알라딘이 잘못 수집된 값)
const 긴긴밤 = priceOf([12500, 12500, 15000]);
check("가장 많이 나온 값 12,500 원", 긴긴밤.value === 12500, 긴긴밤);
check("🚨 서점마다 갈렸다고 표시한다", 긴긴밤.split === true, 긴긴밤);
check("아는 서점 수 3", 긴긴밤.known === 3, 긴긴밤);

console.log("\n[2] 셈 규칙");
check("셋이 같으면 그 값", priceOf([16800, 16800, 16800]).value === 16800);
check("갈리지 않았으면 split=false", priceOf([16800, 16800]).split === false);
check("🚨 1:1 동점이면 비운다", priceOf([12500, 15000]).value === null);
check("동점이어도 갈렸다는 것은 알린다", priceOf([12500, 15000]).split === true);
check("한 서점만 알면 그 값", priceOf([12500, null, null]).value === 12500);
check("아무도 모르면 null", priceOf([null, null]).value === null);
check("아무도 모르면 split=false", priceOf([null, null]).split === false);

console.log("\n[3] 🚨 세 화면이 같은 함수를 쓰는가 (글자로 확인)");
const q = readFileSync("lib/queries.ts", "utf8");
const detail = readFileSync("app/book/[id]/page.tsx", "utf8");
const row = readFileSync("components/BookRow.tsx", "utf8");
const search = readFileSync("app/search/page.tsx", "utf8");
const ui = readFileSync("components/ui.tsx", "utf8");

check("규칙이 한 군데 있다 (priceOf)", /export function priceOf\(/.test(q));
check("🚨 도서 상세가 그 함수를 쓴다", /priceOf\(stores\.map/.test(detail),
  "여기가 달라서 화면마다 다른 값이 나왔습니다");
// ⚠️ 주석에는 남아 있어도 됩니다(왜 고쳤는지 적어 두었으니까요).
//    실제로 **화면에 그리는 코드**에서만 안 쓰면 됩니다.
check("🚨 도서 상세가 '표지 준 서점 값' 을 화면에 안 쓴다",
  !/\{main\.list_price/.test(detail) &&
    !/main\.list_price\.toLocaleString/.test(detail),
  "main 은 표지 우선순위로 고른 서점입니다. 정가와는 상관없습니다");
check("목록도 같은 값을 받는다", /split=\{row\.priceSplit\}/.test(row));
check("검색도 같은 값을 받는다", /split=\{b\.priceSplit\}/.test(search));

console.log("\n[4] 🚨 갈렸으면 화면에 보이는가");
check("Price 가 split 을 받는다", /split = false,/.test(ui));
check("갈렸으면 눈에 띄게 (⚠️)", /⚠️/.test(ui.slice(ui.indexOf("export function Price"))));
check("값을 못 정했는데 갈렸으면 '정가 갈림' 이라고 적는다",
  /정가 갈림/.test(ui),
  "그냥 비우면 '아직 안 걷었나' 하고 넘어가게 됩니다");
check("서점별 화면을 보라고 알려 준다",
  /서점별 화면/.test(ui.slice(ui.indexOf("export function Price"))));

console.log();
if (bad) {
  console.log(`❌ ${bad}개 실패`);
  process.exit(1);
}
console.log("✅ 모두 통과");
