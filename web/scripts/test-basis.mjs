/**
 * 도서 페이지의 '무슨 순위로 볼까요' 와 판매지수 그래프 눈금 시험.
 *
 * 【2026-08-10 대표님 지적 두 가지】
 *  ① "분야에서 순위권에 있다가 종합 순위에 오르기 시작하면 어떡하려고
 *     그래? 이걸 선택할 수 있도록 해주면 좋지 않을까?"
 *  ② "각 서점의 판매지수는 500점 정도는 엄청 큰 격차로 보여줄 필요는 없어."
 *
 * 둘 다 **화면은 멀쩡한데 사람이 정반대로 읽게 되는** 종류입니다.
 * 그래서 눈으로 보고 넘어가면 안 되고 시험으로 못박습니다.
 *
 * 실행: node scripts/test-basis.mjs
 */

import { readFileSync } from "node:fs";

let bad = 0;
function check(name, ok, got) {
  if (ok) console.log(`  ✅ ${name}`);
  else {
    console.log(`  ❌ ${name}${got !== undefined ? `\n       나온 값: ${JSON.stringify(got)}` : ""}`);
    bad++;
  }
}

const q = readFileSync("lib/queries.ts", "utf8");
const page = readFileSync("app/book/[id]/page.tsx", "utf8");
const chart = readFileSync("components/TrendChart.tsx", "utf8");

console.log("\n[1] 🚨 종합과 분야를 한 줄에 섞지 않는다");
// 섞으면 '소설 3위 → 종합 150위' 가 폭락으로 보입니다. 실제로는 승격입니다.
check("두 기준을 따로 담는다 (열쇠에 기준이 들어감)",
  /isOverall \? "A" : "C"/.test(q));
check("'종합이 언제나 이긴다' 규칙을 없앴다",
  !q.includes("종합이 언제나 이깁니다"));
check("같은 기준 안에서만 최고 순위를 고른다",
  /const better = !cur \|\| r\.rank < cur\.rank;/.test(q));

console.log("\n[2] 화면에서 고를 수 있다");
check("주소로 기준을 받는다", page.includes("searchParams") && page.includes("sp.basis"));
check("고르는 버튼이 있다", page.includes("BasisChip"));
check("종합·분야 두 가지", page.includes('basis="overall"') && page.includes('basis="category"'));
check("고른 기준으로 걸러서 그린다",
  /allHistory\.filter\([\s\S]{0,120}h\.isOverall/.test(page));
check("무슨 기준인지 제목 옆에 적는다",
  page.includes("종합(전체) 순위 기준") && page.includes("분야 순위 기준"));
// 한쪽밖에 없는 책에서 버튼을 보여주면 눌러도 아무 일이 없습니다
check("한쪽만 있으면 버튼을 안 보여준다",
  page.includes("hasOverall && hasCategory"));
// 종합에 한 번도 안 오른 책은 종합을 기본으로 두면 빈 그래프가 됩니다
check("종합이 없으면 분야로 시작한다",
  /hasOverall[\s\S]{0,60}"overall"[\s\S]{0,40}"category"/.test(page));

console.log("\n[3] 🚨 판매지수는 기준과 상관없이 그린다");
// 기준으로 거르면 그날 판매지수가 통째로 사라져 없는 구멍이 생깁니다.
check("판매지수는 따로 모은다", page.includes("salesHistory"));
check("판매지수 그래프는 걸러진 것을 안 쓴다",
  page.includes("salesHistory.filter((h) => h.storeId === sid)"));
check("'판매지수 있음' 판단도 따로",
  page.includes("salesHistory.some((h) => h.sales !== null)"));

console.log("\n[4] 🚨 500점 차이가 화면을 가득 채우지 않는다");
check("판매지수에 최소 세로 폭이 있다", /metric === "sales"/.test(chart) && chart.includes("minSpan"));
check("순위에는 안 건드린다 (1위와 5위는 진짜 큰 차이)",
  /if \(metric === "sales"\) \{[\s\S]{0,400}?\n  \}/.test(chart));

// 실제로 계산해 봅니다 — 규칙만 적어 두고 안 지키면 소용없습니다
const m = chart.match(/const minSpan = Math\.max\((\d+), hi \* ([\d.]+)\)/);
check("최소 폭 규칙을 읽을 수 있다", !!m, m?.[0]);
if (m) {
  const floor = Number(m[1]), ratio = Number(m[2]);
  const minSpan = (hi) => Math.max(floor, hi * ratio);
  // 판매지수 10,000 ~ 10,500 (500점 차이)
  const share = 500 / minSpan(10500);
  check(`10,500점에서 500점 차이는 화면의 ${Math.round(share * 100)}% 이하`,
    share <= 0.3, share);
  // 진짜 큰 변화는 그대로 크게 보여야 합니다
  const big = 8000 / Math.max(minSpan(12000), 12000 - 4000);
  check("4,000점 차이는 여전히 크게 보인다", big >= 0.9, big);
}

console.log();
if (bad) { console.log(`❌ ${bad}개 실패`); process.exit(1); }
console.log("✅ 모두 통과");
