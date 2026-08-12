/**
 * 🚨 [강제로 묶기] 화면 시험.
 *
 * 【2026-08-12 대표님 요청】
 *   "내가 강제로 3개를 묶어줄 수 있는 기능을 만들어도 좋을 것 같고."
 *
 * 여기서 틀리면 **누르셨는데 저장이 통째로 실패**합니다.
 * book_matches 표는 '작은 번호, 큰 번호' 순서를 요구하기 때문에,
 * 순서를 뒤집어 보내면 데이터베이스가 줄 전체를 거절합니다.
 *
 * 실행: node scripts/test-join.mjs
 * ※ 인터넷도 DB 도 필요 없습니다.
 */

import { readFileSync } from "node:fs";
import { pairsOf, MAX_JOIN } from "../lib/join-pairs.ts";

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

console.log("\n[1] 고른 책들로 만드는 짝");
check("2권 → 짝 1개", JSON.stringify(pairsOf([7, 3])) === JSON.stringify([[3, 7]]),
  pairsOf([7, 3]));
check("3권 → 짝 3개 (대표님이 말씀하신 '강제로 3개')",
  pairsOf([5, 1, 9]).length === 3, pairsOf([5, 1, 9]));
check("1권만 고르면 짝이 없다", pairsOf([4]).length === 0);
check("아무것도 안 고르면 짝이 없다", pairsOf([]).length === 0);

console.log("\n[2] 🚨 언제나 (작은 번호, 큰 번호) 순서여야 합니다");
// 순서가 뒤집히면 데이터베이스가 줄 전체를 거절합니다 (CHECK a < b).
for (const input of [[9, 2, 5], [1, 2, 3], [30, 10, 20, 40], [100, 1]]) {
  const ps = pairsOf(input);
  check(`${JSON.stringify(input)} — 모두 a < b`,
    ps.every(([a, b]) => a < b), ps);
}

console.log("\n[3] 같은 것을 두 번 고르면 한 번만 셉니다");
// 같은 짝을 두 번 보내면 UNIQUE 규칙에 걸려 저장이 실패합니다.
check("중복을 지운다", pairsOf([5, 5, 8]).length === 1, pairsOf([5, 5, 8]));
const ps = pairsOf([3, 1, 3, 1]);
check("전부 같은 번호면 짝 1개", ps.length === 1, ps);

console.log("\n[4] 🚨 화면·저장이 서로 맞물려 있는가");
const route = readFileSync("app/review/join/decide/route.ts", "utf8");
const page = readFileSync("app/review/join/page.tsx", "utf8");
const review = readFileSync("app/review/page.tsx", "utf8");

check("2권 미만은 막는다", /ids\.length < 2/.test(route));
check(`${MAX_JOIN}권을 넘으면 막는다`, /ids\.length > MAX_JOIN/.test(route));
check("있는 상품인지 먼저 확인한다", /from\("store_books"\)[\s\S]{0,60}\.in\("id", ids\)/.test(route));
check("🚨 저장된 줄 수를 세어 확인한다", /done !== pairs\.length/.test(route),
  "안 세면 규칙에 막혀 0줄이 저장돼도 '성공' 이라고 합니다");
check("권한이 없으면 무엇을 해야 하는지 알려 준다",
  /force-join\.sql/.test(page));
check("돌아갈 곳은 우리 사이트 안으로만", /startsWith\("\/review"\)/.test(route));

check("매칭 검토에서 이 화면으로 가는 길이 있다",
  /href="\/review\/join"/.test(review),
  "길이 없으면 만들어도 아무도 못 찾습니다");
check("관리자만 볼 수 있다", /role !== "admin"/.test(page));
check("내일 아침 반영된다는 것을 알려 준다", /내일 아침/.test(page));
check("이미 묶인 도서번호를 보여 준다", /도서번호/.test(page),
  "안 보여주면 이미 한 책인 것을 또 묶고 '변화가 없다' 고 느끼십니다");

console.log();
if (bad) {
  console.log(`❌ ${bad}개 실패`);
  process.exit(1);
}
console.log("✅ 모두 통과");
