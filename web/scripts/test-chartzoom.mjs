/**
 * 그래프 밑 '숫자로 보기' 규칙 시험.
 *
 * 【왜 기계가 보나요?】
 * 이 표는 **틀려도 멀쩡해 보입니다.** 숫자가 가득 차 있으면 사람은
 * 맞다고 믿습니다. 특히 두 가지가 위험합니다.
 *
 *   ① 순위는 **작아지는 것이 오르는 것**이고 판매지수는 반대입니다.
 *      ▲▼ 를 뒤집어 붙이면 폭락을 상승으로 읽게 됩니다.
 *   ② 값이 없는 날을 0 으로 적으면 '그날 0위' 처럼 읽힙니다.
 *
 * 【2026-08-18 — 화면을 단순하게 바꿨습니다】
 *   "'숫자로 자세히 보기' 영역이 지나치게 복잡하게 느껴지고,
 *    글자가 길어서 행이 넘어가서 가독성이 떨어지는 경우도 많아."
 * 서점별 요약표(최고·최저·평균·오른 날·연속·처음→지금)를 뺐습니다.
 * 그래서 그 항목을 보던 시험도 함께 걷어냅니다. **규칙 시험은 남깁니다.**
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

/* ChartZoom.tsx 의 규칙을 그대로 옮겨 온 것 (tsx 는 node 가 못 읽습니다) */
const isBetter = (a, b, metric) => (metric === "rank" ? a < b : a > b);

function delta(rows, i, storeId, metric) {
  const now = rows[i]?.by.get(storeId);
  if (!now) return null;
  for (let k = i + 1; k < rows.length; k++) {
    const prev = rows[k].by.get(storeId);
    if (!prev) continue;
    const d = now.v - prev.v;
    if (d === 0) return null;
    return {
      text: `${isBetter(now.v, prev.v, metric) ? "▲" : "▼"}${Math.abs(d).toLocaleString("ko-KR")}`,
      up: isBetter(now.v, prev.v, metric),
    };
  }
  return null;
}

/** 최신이 위 (표와 같은 차례) */
const mk = (...days) =>
  days.map(([date, v]) => ({
    date,
    by: new Map(v === null ? [] : [[1, { v, cat: "소설", overall: false, more: 0 }]]),
  }));

console.log("\n[1] 🚨 순위는 작아지는 것이 '오름' 입니다");
const rank = mk(["2026-08-18", 3], ["2026-08-17", 10]);
check("10위 → 3위 는 ▲", delta(rank, 0, 1, "rank")?.up === true);
check("숫자는 차이만큼 (7)", delta(rank, 0, 1, "rank")?.text === "▲7",
  delta(rank, 0, 1, "rank"));
check("10위 → 30위 는 ▼",
  delta(mk(["2026-08-18", 30], ["2026-08-17", 10]), 0, 1, "rank")?.up === false);

console.log("\n[2] 🚨 판매지수는 반대 — 커지는 것이 '오름' 입니다");
check("9,000 → 12,000 은 ▲",
  delta(mk(["2026-08-18", 12000], ["2026-08-17", 9000]), 0, 1, "sales")?.up === true);
check("세 자리마다 쉼표",
  delta(mk(["2026-08-18", 12000], ["2026-08-17", 9000]), 0, 1, "sales")?.text === "▲3,000");
check("12,000 → 9,000 은 ▼",
  delta(mk(["2026-08-18", 9000], ["2026-08-17", 12000]), 0, 1, "sales")?.up === false);

console.log("\n[3] 🚨 중간에 순위 밖으로 나간 날은 건너뜁니다");
// 8/15 에 5위 → 8/16·8/17 순위 밖 → 8/18 에 6위.
// 바로 윗줄(8/17)은 값이 없습니다. 그걸 무시하고 윗줄과 견주면
// 아무 말도 못 하거나, 열흘 전 값을 '어제' 라고 적게 됩니다.
const gap = mk(
  ["2026-08-18", 6], ["2026-08-17", null], ["2026-08-16", null], ["2026-08-15", 5]
);
check("값이 있던 마지막 날(8/15)과 견준다",
  delta(gap, 0, 1, "rank")?.text === "▼1", delta(gap, 0, 1, "rank"));

console.log("\n[4] 등락을 안 붙이는 경우");
check("처음 나온 기록이면 null",
  delta(mk(["2026-08-18", 3]), 0, 1, "rank") === null);
check("값이 없는 줄도 null",
  delta(mk(["2026-08-18", null], ["2026-08-17", 3]), 0, 1, "rank") === null);
check("변화가 없으면 아무것도 안 적는다 (▲0 이 아니라)",
  delta(mk(["2026-08-18", 3], ["2026-08-17", 3]), 0, 1, "rank") === null);

const src = readFileSync("components/ChartZoom.tsx", "utf8");
const chart = readFileSync("components/TrendChart.tsx", "utf8");
const page = readFileSync("app/book/[id]/page.tsx", "utf8");

/* ⚠️ 주석에 '평균·오른 날' 같은 말이 남아 있어도 됩니다 — 무엇을 왜 뺐는지
      적어 두는 것이 낫습니다. 그러니 **실제로 그리는 부분**만 봅니다. */
const view = src.slice(src.indexOf("export default function"));

console.log("\n[5] 🚨 값이 없는 날을 '0' 으로 적지 않는다");
check("빈 칸에 숫자를 안 넣는다",
  !/\?\?\s*0/.test(src) && !/\|\|\s*0/.test(src));
check("— 가 무슨 뜻인지 적어 준다", /기록이 없다는 뜻/.test(src));

console.log("\n[6] 🚨 단순하게 유지되는가 (2026-08-18 대표님 지적)");
check("그림을 다시 그리지 않는다", !/TrendChart/.test(src),
  "위에 이미 그림이 있습니다");
check("TrendChart 에 안 쓰는 tall 이 남아 있지 않다", !/tall/.test(chart));
check("표가 하나뿐이다", (view.match(/<table/g) || []).length === 1,
  "요약표를 다시 붙이면 가로로 넘칩니다");
check("서점별 요약표를 안 만든다",
  !/평균/.test(view) && !/오른 날/.test(view) && !/처음 → 지금/.test(view));
check("한 줄 요약만 남긴다 (최고 기록)", /최고 </.test(view));
check("긴 설명을 붙이지 않는다",
  (view.match(/<p className="border-t/g) || []).length <= 1);

console.log("\n[7] 🚨 줄이 넘어가지 않게 (가독성)");
check("칸 안에서 줄바꿈을 막는다", /whitespace-nowrap px-3/.test(src));
check("분야 이름이 길면 잘라낸다", /truncate/.test(src));
check("분야를 종합일 때는 안 적는다", /!cell\.overall/.test(src),
  "'종합' 이라고 매 줄 적으면 그만큼 길어집니다");
check("여러 분야는 이름 대신 개수로", /외 \$\{cell\.more\}|외 \${cell\.more}/.test(src) ||
  /외 \$\{/.test(src) || /` 외 /.test(src),
  "이름을 전부 적으면 줄이 계속 넘어갑니다");
check("좁은 화면에서 표가 옆으로 밀린다", /scroll-x/.test(src));

console.log("\n[8] 🚨 그래프마다 하나씩 붙어 있는가");
check("도서 페이지가 ChartZoom 을 불러온다",
  /import ChartZoom from "@\/components\/ChartZoom"/.test(page));
const uses = (page.match(/<ChartZoom/g) || []).length;
check(`순위·판매지수 두 곳에 붙었다 (지금 ${uses}곳)`, uses === 2,
  "각각 일간·주간 / 예스24·알라딘 으로 두 번씩 그려져 네 개가 됩니다");
check("순위 그래프에 붙었다", /<ChartZoom[^>]*metric="rank"/s.test(page));
check("판매지수 그래프에 붙었다", /<ChartZoom[\s\S]{0,200}metric="sales"/.test(page));
check("판매지수는 서점 하나만 그린다", /storeId=\{sid\}/.test(page));

console.log("\n[9] 자바스크립트 없이 열린다");
check("<details> 를 쓴다", /<details/.test(src));
check("'use client' 가 필요 없다", !/use client/.test(src));
check("눌러서 열 수 있게 보인다", /cursor-pointer/.test(src));

console.log("\n[10] 같은 날 여러 분야에 올라 있으면");
check("대표값은 더 좋은 쪽", /isBetter\(v, cur\.v, metric\)/.test(src));
check("판매지수에는 분야를 안 적는다",
  /const showCat = metric === "rank"/.test(src),
  "판매지수는 분야와 무관한 값이라 적으면 오해를 부릅니다");

console.log();
if (bad) {
  console.log(`❌ ${bad}개 실패`);
  process.exit(1);
}
console.log("✅ 모두 통과");
