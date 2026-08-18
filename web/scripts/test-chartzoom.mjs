/**
 * 그래프 '자세히 보기' 규칙 시험.
 *
 * 【2026-08-18 대표님 요청】
 *   "그래프의 경우, 지금보다 더 자세하게 볼 수 있는 버튼을
 *    각 그래프마다 도서 페이지에서 하나씩 추가해줄래?"
 *
 * 이 화면은 **틀려도 멀쩡해 보입니다.** 표에 숫자가 가득 차 있으면
 * 사람은 맞다고 믿습니다. 그래서 기계가 봅니다. 특히 두 가지:
 *
 *   ① 순위는 **작아지는 것이 오르는 것**입니다. 판매지수는 반대입니다.
 *      ▲▼ 를 반대로 붙이면 폭락을 상승으로 읽게 됩니다.
 *   ② 값이 없는 날을 0 이나 '-' 로 적으면 '그날 0위' 처럼 읽힙니다.
 *
 * 실행: node scripts/test-chartzoom.mjs
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

/* ChartZoom.tsx 의 delta() 를 그대로 옮겨 온 것 — 규칙만 확인합니다
   (tsx 는 node 가 바로 못 읽습니다) */
function delta(rows, i, storeId, metric) {
  const now = rows[i]?.by.get(storeId);
  if (!now) return null;
  for (let k = i + 1; k < rows.length; k++) {
    const prev = rows[k].by.get(storeId);
    if (!prev) continue;
    const d = now.v - prev.v;
    if (d === 0) return { text: "—", up: false };
    const up = metric === "rank" ? d < 0 : d > 0;
    return { text: `${up ? "▲" : "▼"}${Math.abs(d).toLocaleString("ko-KR")}`, up };
  }
  return null;
}

/** 최신이 위 (표와 같은 차례) */
const mk = (...days) =>
  days.map(([date, v]) => ({
    date,
    by: new Map(v === null ? [] : [[1, { v, cat: "소설" }]]),
  }));

console.log("\n[1] 🚨 순위는 작아지는 것이 '오름' 입니다");
const rank = mk(["2026-08-18", 3], ["2026-08-17", 10]);
check("10위 → 3위 는 ▲", delta(rank, 0, 1, "rank")?.up === true,
  delta(rank, 0, 1, "rank"));
check("숫자는 차이만큼 (7)", delta(rank, 0, 1, "rank")?.text === "▲7",
  delta(rank, 0, 1, "rank"));
const down = mk(["2026-08-18", 30], ["2026-08-17", 10]);
check("10위 → 30위 는 ▼", delta(down, 0, 1, "rank")?.up === false,
  delta(down, 0, 1, "rank"));

console.log("\n[2] 🚨 판매지수는 반대 — 커지는 것이 '오름' 입니다");
const sales = mk(["2026-08-18", 12000], ["2026-08-17", 9000]);
check("9,000 → 12,000 은 ▲", delta(sales, 0, 1, "sales")?.up === true);
check("세 자리마다 쉼표", delta(sales, 0, 1, "sales")?.text === "▲3,000",
  delta(sales, 0, 1, "sales"));
const sdown = mk(["2026-08-18", 9000], ["2026-08-17", 12000]);
check("12,000 → 9,000 은 ▼", delta(sdown, 0, 1, "sales")?.up === false);

console.log("\n[3] 🚨 중간에 순위 밖으로 나간 날은 건너뜁니다");
// 8/15 에 5위 → 8/16·8/17 순위 밖 → 8/18 에 6위.
// 바로 윗줄(8/17)은 값이 없습니다. 그걸 무시하고 윗줄과 견주면
// 아무 말도 못 하거나, 열흘 전 값을 '어제' 라고 적게 됩니다.
const gap = mk(
  ["2026-08-18", 6],
  ["2026-08-17", null],
  ["2026-08-16", null],
  ["2026-08-15", 5]
);
const g = delta(gap, 0, 1, "rank");
check("값이 있던 마지막 날(8/15)과 견준다", g?.text === "▼1", g);
check("건너뛴 날 때문에 죽지 않는다", g !== null);

console.log("\n[4] 처음 나온 기록에는 등락을 안 붙입니다");
check("앞 기록이 없으면 null",
  delta(mk(["2026-08-18", 3]), 0, 1, "rank") === null);
check("값이 없는 줄도 null",
  delta(mk(["2026-08-18", null], ["2026-08-17", 3]), 0, 1, "rank") === null);

console.log("\n[5] 같으면 — 로 적습니다 (▲0 이 아니라)");
const same = mk(["2026-08-18", 3], ["2026-08-17", 3]);
check("변화가 없으면 —", delta(same, 0, 1, "rank")?.text === "—");
check("— 는 오름으로 칠하지 않는다", delta(same, 0, 1, "rank")?.up === false);

const src = readFileSync("components/ChartZoom.tsx", "utf8");
const chart = readFileSync("components/TrendChart.tsx", "utf8");
const page = readFileSync("app/book/[id]/page.tsx", "utf8");

console.log("\n[6] 🚨 값이 없는 날을 '0' 이나 '-' 로 적지 않는다");
check("'순위 밖' 이라고 적는다", /순위 밖/.test(src),
  "0 으로 적으면 '그날 0위' 처럼 읽힙니다");
check("빈 칸에 숫자를 안 넣는다", !/\?\?\s*0/.test(src) && !/\|\|\s*0/.test(src));

console.log("\n[7] 자세히 보기가 실제로 더 자세한가");
check("세로를 늘린다 (tall)", /tall\b/.test(src) && /tall\?: boolean/.test(chart));
check("펴면 400, 평소엔 220", /const H_TALL = 400/.test(chart) &&
  /const H_BASE = 220/.test(chart));
check("펴면 눈금이 늘어난다", /tall \? 8 : 4/.test(chart));
check("펴면 날짜도 더 적는다", /tall \? 7 : 3/.test(chart));
check("🚨 숫자를 표로 보여준다", /<table/.test(src));
check("전날 대비 등락을 적는다", /▲/.test(src) && /▼/.test(src));

console.log("\n[8] 🚨 그래프마다 하나씩 붙어 있는가 (네 개)");
// 순위 추이 일간 · 주간 + 판매지수 예스24 · 알라딘 = 네 개.
// 한 군데만 빠뜨려도 화면은 멀쩡해 보입니다.
check("도서 페이지가 ChartZoom 을 불러온다",
  /import ChartZoom from "@\/components\/ChartZoom"/.test(page));
const uses = (page.match(/<ChartZoom/g) || []).length;
check(`순위·판매지수 두 곳에 붙었다 (지금 ${uses}곳)`, uses === 2,
  "두 곳이 각각 일간·주간 / 예스24·알라딘 으로 두 번씩 그려져 네 개가 됩니다");
check("순위 그래프에 붙었다", /<ChartZoom[^>]*metric="rank"/s.test(page));
check("판매지수 그래프에 붙었다", /<ChartZoom[\s\S]{0,200}metric="sales"/.test(page));
check("판매지수는 서점 하나만 그린다 (storeId 를 넘긴다)",
  /storeId=\{sid\}/.test(page));

console.log("\n[9] 자바스크립트 없이 열린다");
// 브라우저가 원래 갖고 있는 접이식 상자를 씁니다. 코드가 없으니
// 고장 날 것도 없고, 열 때 기다릴 것도 없습니다.
check("<details> 를 쓴다", /<details/.test(src));
check("'use client' 가 필요 없다", !/use client/.test(src));
check("눌러서 열 수 있게 보인다", /cursor-pointer/.test(src));

console.log("\n[10] 넓지 않은 화면에서도 표를 볼 수 있는가");
check("표가 옆으로 밀린다 (scroll-x)", /scroll-x/.test(src));
check("표가 너무 좁아지지 않는다", /min-w-\[/.test(src));

console.log("\n[11] 같은 날 같은 서점에 여러 분야가 있으면");
// 한 책이 '소설' 3위이자 '종합' 150위일 수 있습니다.
// 표에 아무거나 적으면 그래프와 다른 숫자가 나옵니다.
check("순위는 더 높은 쪽(작은 수)을 쓴다", /v < cur\.v/.test(src));
check("어느 분야에서 나온 값인지 적는다", /cell\.cat/.test(src));

console.log();
if (bad) {
  console.log(`❌ ${bad}개 실패`);
  process.exit(1);
}
console.log("✅ 모두 통과");
