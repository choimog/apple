/**
 * 정가 표기 시험 — 2026-08-11 대표님 요청
 *
 *   "도서 상세페이지가 아니더라도, 웰컴, 종합, 서점별, 출판사를 클릭했을 때,
 *    작가를 클릭했을 때, 도서 검색 등등 (작가명)(출판사) 나오는 곳 옆에
 *    (정가)도 나왔으면 좋겠어"
 *
 * 【왜 시험이 필요한가요?】
 * 여섯 군데에 손으로 붙이는 일이라, 한 군데를 빠뜨려도 **화면은 멀쩡합니다.**
 * 대표님이 그 화면을 열어 보시기 전까지 아무도 모릅니다.
 * 그래서 '여섯 군데에 다 붙었는지' 를 글자로 확인합니다.
 *
 * 그리고 값이 갈렸을 때 한쪽을 골라 보여주면, 확인된 값인 줄 아시게 됩니다.
 * 그건 비어 있는 것보다 나쁩니다. 그 경계도 함께 지킵니다.
 *
 * 실행: node scripts/test-price.mjs
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

const q = readFileSync("lib/queries.ts", "utf8");
const qx = readFileSync("lib/queries-extra.ts", "utf8");
const ui = readFileSync("components/ui.tsx", "utf8");

console.log("\n[1] 여섯 화면에 정가가 붙어 있나");

const screens = [
  ["웰컴(홈)", "app/page.tsx", /listPrice[^\n]*toLocaleString\(\)\}?원/],
  ["종합·출판사·작가 (공통 줄)", "components/BookRow.tsx", /<Price value=\{row\.listPrice\}/],
  ["서점별", "app/store/page.tsx", /list_price[^\n]*toLocaleString\(\)\}?원/],
  ["도서 검색", "app/search/page.tsx", /<Price value=\{b\.listPrice\}/],
  // 2026-08-12: 목록·검색과 같은 규칙(priceOf)을 쓰도록 고쳤습니다.
  //             예전에는 '표지 준 서점의 값' 을 그대로 썼습니다.
  ["도서 상세", "app/book/[id]/page.tsx", /<Price value=\{price\.value\}/],
];
for (const [label, file, re] of screens) {
  const src = readFileSync(file, "utf8");
  check(`${label} — ${file}`, re.test(src));
}

console.log("\n[1-1] 출간월도 같은 자리에 붙어 있나 (2026-08-19 대표님 요청)");
// "종합이랑 즐겨찾기 등 도서 노출 시 출간월도 함께 나오게 해줘."
// 정가와 똑같이, 한 군데를 빠뜨려도 화면은 멀쩡합니다.
const ymScreens = [
  ["웰컴(홈)", "app/page.tsx", /r\.pubYm && ` · \$\{r\.pubYm\}`/],
  ["종합·즐겨찾기·출판사·작가 (공통 줄)", "components/BookRow.tsx", /\{row\.pubYm && \(/],
  ["서점별", "app/store/page.tsx", /store_book\.pub_ym/],
  ["도서 검색", "app/search/page.tsx", /\{b\.pubYm && \(/],
  ["도서 상세", "app/book/[id]/page.tsx", /main\.pub_ym/],
];
for (const [label, file, re] of ymScreens) {
  check(`${label} — ${file}`, re.test(readFileSync(file, "utf8")));
}

// 🚨 여기가 핵심입니다. 서점마다 배본일을 다르게 적습니다(인쇄일/출고일/
//    판매일). 목록에서 따로 고르면 도서 상세와 **다른 달**이 찍힙니다.
//    도서 마스터가 정해 둔 대표값(books.pub_ym)을 그대로 읽어야 합니다.
check("목록은 도서 마스터의 대표 출간월을 읽는다",
  /from\("books"\)\s*\n?\s*\.select\("id, pub_ym"\)/.test(q),
  "store_books 에서 다시 고르면 화면마다 다른 달이 나옵니다");
check("고르는 규칙을 화면에 다시 만들지 않았다",
  !/pub_ym[^\n]*STORE_PRIORITY|알라딘.*예스24.*교보/.test(
    readFileSync("components/BookRow.tsx", "utf8")));

// 출판사·작가 화면이 정말 같은 줄(BookRow)을 쓰는지도 확인합니다.
// 여기가 어긋나면 위 시험이 통과해도 그 두 화면엔 정가가 안 뜹니다.
const nameDetail = readFileSync("components/NameDetailPage.tsx", "utf8");
check(
  "출판사·작가 상세가 그 공통 줄을 쓴다",
  /import BookRow/.test(nameDetail) && /<BookRow/.test(nameDetail)
);

console.log("\n[2] 정가를 어디서 가져오나");
check("한 번에 여러 권을 물어보는 함수가 있다", /export async function storeInfoByBook/.test(q));
check(
  "주소가 길어지지 않게 나눠서 물어본다",
  /i \+= 300/.test(q),
  "300개씩 안 나누면 요청 자체가 실패합니다"
);
/*
  ⚠️ 【2026-08-12 — 이 규칙은 일부러 뒤집었습니다】
  예전에는 정가가 있는 줄만 받아왔습니다(받는 양을 줄이려고).
  그런데 같은 조회로 '이 책에 묶여 있는 서점' 도 함께 읽게 되면서,
  정가로 걸러내면 **정가를 아직 안 걷은 서점이 '안 묶인' 것처럼**
  보이게 됩니다. 그래서 전부 받아 오고 코드에서 나눕니다.
  (받는 양은 조금 늘지만 화면에 보이는 100권뿐이라 차이가 없습니다)
*/
check("🚨 정가로 줄을 걸러내지 않는다 (걸러내면 '안 묶임' 이 틀리게 나옵니다)",
  !/\.select\("book_id, store_id, list_price"\)[\s\S]{0,150}\.not\("list_price"/.test(q));
check("대신 코드에서 빈 정가를 건너뛴다",
  /if \(r\.list_price === null\) continue;/.test(q));
/*
  ⚠️ `await fillStoreInfo(...)` 라는 글자로 세지 않습니다 (2026-08-19).
     등락을 넣으면서 빠른 길이 Promise.all 로 바뀌어 `await` 가 앞에서
     사라졌습니다. 정가는 그대로 채우는데 시험만 빨간불이 났습니다.
     보는 것은 **부르는지** 이지 어떻게 기다리는지가 아닙니다.
*/
const fills = q.match(/fillStoreInfo\((rows|top)\)/g) || [];
check("종합 순위에 정가를 채운다", /fillStoreInfo\(rows\)/.test(q));
check("느린 길에도 채운다", /fillStoreInfo\(top\)/.test(q));
check("출판사·작가 목록에도 채운다", fills.length >= 3, fills);
check("검색 결과에도 채운다", /storeInfoByBook\(rows\.map/.test(qx));

console.log("\n[3] 🚨 값이 갈리면 지어내지 않는다 (가장 중요)");
// bestPrice 를 이 파일 안에서 그대로 옮겨 와 동작을 확인합니다.
// (lib/queries.ts 는 Supabase 를 불러오므로 여기서 직접 import 할 수 없습니다)
// (lib/queries.ts 는 Supabase 를 불러오므로 여기서 import 할 수 없습니다.
//  타입 표기만 걷어내면 그대로 도는 코드라 그렇게 씁니다.)
const src = q.slice(q.indexOf("export function bestPrice"));
const body = src.slice(src.indexOf("{") + 1, src.indexOf("\n}"));
const js = body.replace(/(\b(?:let|const|var)\s+\w+)\s*:[^=;]+(?==)/g, "$1 ");
const bestPrice = new Function("votes", js);

check("한 값만 있으면 그 값", bestPrice(new Map([[18000, 3]])) === 18000);
check(
  "둘 중 많이 나온 쪽을 고른다",
  bestPrice(new Map([[18000, 2], [22000, 1]])) === 18000,
  bestPrice(new Map([[18000, 2], [22000, 1]]))
);
check(
  "🚨 동점이면 비운다 (한쪽을 골라 보여주지 않는다)",
  bestPrice(new Map([[18000, 1], [22000, 1]])) === null,
  bestPrice(new Map([[18000, 1], [22000, 1]]))
);
check(
  "🚨 셋 다 다르면 비운다",
  bestPrice(new Map([[18000, 1], [22000, 1], [25000, 1]])) === null,
  bestPrice(new Map([[18000, 1], [22000, 1], [25000, 1]]))
);
check("아무 값도 없으면 null", bestPrice(new Map()) === null);

console.log("\n[4] 값이 없을 때 화면이 지어내지 않는다");
const priceFn = ui.slice(ui.indexOf("export function Price"), ui.indexOf("접기 설명"));
/*
  ⚠️ 【2026-08-12 — 이 규칙을 한 겹 더 나눴습니다】
  예전 규칙: "값이 없으면 아무것도 안 그린다."
  그런데 비어 있는 이유가 두 가지라는 것이 드러났습니다.

    ① 아직 정가를 안 걷었다        → 그릴 것이 없습니다 (예전 그대로)
    ② 🚨 서점마다 값이 달라 못 정했다 → '정가 갈림' 이라고 적습니다

  둘을 같이 비워 두면 대표님이 ②를 ①로 오해하고 넘어가게 됩니다.
  『긴긴밤』 처럼 한 서점이 잘못 수집한 경우를 못 찾게 됩니다.
  ※ 값을 지어내는 것이 아니라 **없는 이유**를 적는 것입니다.
*/
check("정가를 아직 안 걷었으면 아무것도 안 그린다",
  /if \(!split\) return null;/.test(priceFn));
check(
  "'0원' 이나 '정가 미상' 같은 말을 안 만든다",
  // ⚠️ 설명글(주석)에는 그 말이 나옵니다. 그리는 부분만 봅니다.
  !/정가 미상|0원|정가 없음/.test(priceFn.replace(/\/\*[\s\S]*?\*\//g, ""))
);

console.log("\n[5] 서점별 화면은 그 서점 값을 그대로 쓴다");
// 서점별 화면에서 다른 서점 정가를 섞어 보여주면 '이 서점이 그렇게 적었다' 는
// 뜻이 아니게 됩니다. 그 화면만은 store_books 의 값을 직접 씁니다.
const storePage = readFileSync("app/store/page.tsx", "utf8");
check("store_book.list_price 를 직접 쓴다", /r\.store_book\.list_price/.test(storePage));
check("합쳐진 값(listPrice)을 안 쓴다", !/\blistPrice\b/.test(storePage));

console.log();
if (bad) {
  console.log(`❌ ${bad}개 실패`);
  process.exit(1);
}
console.log("✅ 모두 통과");
