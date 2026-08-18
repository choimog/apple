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

/* ChartZoom.tsx 의 규칙을 그대로 옮겨 온 것 — 값만 확인합니다
   (tsx 는 node 가 바로 못 읽습니다) */
const isBetter = (a, b, metric) => (metric === "rank" ? a < b : a > b);

function delta(rows, i, storeId, metric) {
  const now = rows[i]?.by.get(storeId);
  if (!now) return null;
  for (let k = i + 1; k < rows.length; k++) {
    const prev = rows[k].by.get(storeId);
    if (!prev) continue;
    const d = now.best - prev.best;
    if (d === 0) return { text: "그대로", up: false, flat: true };
    const up = isBetter(now.best, prev.best, metric);
    return {
      text: `${up ? "▲" : "▼"}${Math.abs(d).toLocaleString("ko-KR")}`,
      up,
      flat: false,
    };
  }
  return null;
}

function statOf(rows, storeId, metric) {
  const seen = rows
    .map((r) => ({ date: r.date, cell: r.by.get(storeId) }))
    .filter((e) => !!e.cell);
  if (!seen.length) return null;
  const vals = seen.map((e) => e.cell.best);
  let best = vals[0];
  let worst = vals[0];
  for (const v of vals) {
    if (isBetter(v, best, metric)) best = v;
    if (isBetter(worst, v, metric)) worst = v;
  }
  let ups = 0, downs = 0, sames = 0;
  for (let i = seen.length - 2; i >= 0; i--) {
    const d = seen[i].cell.best - seen[i + 1].cell.best;
    if (d === 0) sames++;
    else if (isBetter(seen[i].cell.best, seen[i + 1].cell.best, metric)) ups++;
    else downs++;
  }
  let streak = 0;
  for (const r of rows) {
    if (!r.by.has(storeId)) break;
    streak++;
  }
  return {
    days: seen.length, best, worst,
    avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    first: seen[seen.length - 1].cell.best,
    last: seen[0].cell.best,
    ups, downs, sames, streak,
  };
}

/** 최신이 위 (표와 같은 차례) */
const mk = (...days) =>
  days.map(([date, v]) => ({
    date,
    by: new Map(v === null ? [] : [[1, { best: v, places: [{ cat: "소설", v }] }]]),
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

console.log("\n[5] 같으면 '그대로' 라고 적습니다 (▲0 이 아니라)");
const same = mk(["2026-08-18", 3], ["2026-08-17", 3]);
check("변화가 없으면 '그대로'", delta(same, 0, 1, "rank")?.text === "그대로");
check("'그대로' 는 오름으로 칠하지 않는다",
  delta(same, 0, 1, "rank")?.flat === true &&
  delta(same, 0, 1, "rank")?.up === false);

console.log("\n[6] 🚨 요약 숫자 — 순위와 판매지수가 반대인 것들");
// 최고/최저·오른 날/내린 날은 방향을 한 번만 잘못 잡으면 전부 뒤집힙니다.
const r = mk(
  ["2026-08-18", 8],   // 5 → 8 : 내림
  ["2026-08-17", 5],   // 20 → 5 : 오름
  ["2026-08-16", 20],
  ["2026-08-15", null] // 순위 밖
);
const sr = statOf(r, 1, "rank");
check("순위 최고는 가장 작은 수 (5위)", sr.best === 5, sr);
check("순위 최저는 가장 큰 수 (20위)", sr.worst === 20, sr);
check("기록된 날은 값이 있는 날만 (3일)", sr.days === 3, sr);
check("평균은 (8+5+20)/3 = 11", Math.abs(sr.avg - 11) < 0.001, sr.avg);
check("오른 날 1 · 내린 날 1", sr.ups === 1 && sr.downs === 1, sr);
check("처음은 가장 오래된 값 (20위)", sr.first === 20, sr);
check("지금은 가장 최근 값 (8위)", sr.last === 8, sr);

const sv = statOf(
  mk(["2026-08-18", 9000], ["2026-08-17", 12000], ["2026-08-16", 5000]),
  1, "sales"
);
check("🚨 판매지수 최고는 가장 큰 수 (12,000)", sv.best === 12000, sv);
check("🚨 판매지수 최저는 가장 작은 수 (5,000)", sv.worst === 5000, sv);
check("판매지수도 오른 날 1 · 내린 날 1", sv.ups === 1 && sv.downs === 1, sv);

console.log("\n[6-1] '연속' 은 날이 아니라 '몇 번' 입니다");
// 수집이 안 된 날은 애초에 표에 없습니다. 그 날을 끊긴 것으로 세면
// "어제 끊겼다" 는 거짓말이 됩니다.
check("최근부터 이어진 횟수 (3회)", sr.streak === 3, sr.streak);
const broke = statOf(mk(["2026-08-18", null], ["2026-08-17", 5]), 1, "rank");
check("가장 최근에 값이 없으면 0회", broke.streak === 0, broke.streak);

const src = readFileSync("components/ChartZoom.tsx", "utf8");
const chart = readFileSync("components/TrendChart.tsx", "utf8");
const page = readFileSync("app/book/[id]/page.tsx", "utf8");

console.log("\n[7] 🚨 값이 없는 날을 '0' 이나 '-' 로 적지 않는다");
check("순위는 '순위 밖' 이라고 적는다", /"순위 밖"/.test(src),
  "0 으로 적으면 '그날 0위' 처럼 읽힙니다");
check("판매지수는 '기록 없음' 이라고 적는다", /"기록 없음"/.test(src),
  "판매지수에 '순위 밖' 은 말이 안 됩니다");
check("빈 칸에 숫자를 안 넣는다", !/\?\?\s*0/.test(src) && !/\|\|\s*0/.test(src));

console.log("\n[7-1] 🚨 그림은 다시 그리지 않는다 (2026-08-18 대표님 지시)");
// "자세히보기를 클릭했을 때, 그래프까지는 보여줄 필요는 없을 것 같아.
//  말한 것처럼 숫자 정도만 나오면 좋을 것 같아."
// 위에 이미 그림이 있는데 밑에 또 그리면 자리만 먹습니다.
check("TrendChart 를 안 쓴다", !/TrendChart/.test(src),
  "위에 있는 그림을 한 번 더 그리면 안 됩니다");
check("TrendChart 에 안 쓰는 tall 이 남아 있지 않다", !/tall/.test(chart),
  "안 쓰는 코드가 남으면 다음 사람이 쓰는 줄 압니다");

console.log("\n[7-2] 그림이 못 말해 주는 것을 전부 보여주는가");
check("① 정확한 값 (표)", /<table/.test(src));
check("② 앞 기록 대비 등락", /▲/.test(src) && /▼/.test(src));
check("③ 어느 분야에서 나온 순위인지", /cell\.places/.test(src));
check("③-1 한 날에 여러 분야면 전부 적는다",
  /places\s*\n?\s*\.map/.test(src) || /places\.map/.test(src),
  "그림은 대표값 하나만 그리므로 나머지는 여기가 아니면 볼 곳이 없습니다");
check("④ 요약 — 최고", /최고/.test(src));
check("④ 요약 — 최저", /최저/.test(src));
check("④ 요약 — 평균", /평균/.test(src));
check("④ 요약 — 오른 날 / 내린 날", /오른 날/.test(src) && /내린 날/.test(src));
check("④ 요약 — 연속", /연속/.test(src));
check("④ 요약 — 처음 → 지금", /처음 → 지금/.test(src));
check("⑤ 없는 날을 글자로 적는다", /\{missing\}/.test(src));
check("기간을 적는다 (언제부터 언제까지)", /기록된 날/.test(src));

console.log("\n[7-3] 순위 평균은 소수점까지 (반올림하면 다 같아 보입니다)");
check("순위 평균에 toFixed(1)", /avg\.toFixed\(1\)/.test(src));
check("판매지수 평균은 정수", /Math\.round\(s\.avg\)/.test(src));

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
// 표에 아무거나 적으면 위 그림과 다른 숫자가 나옵니다.
check("대표값은 더 좋은 쪽 (순위는 작은 수, 지수는 큰 수)",
  /isBetter\(v, cur\.best, metric\)/.test(src));
check("나머지 분야도 버리지 않고 들고 있다", /cur\.places\.push/.test(src));
check("좋은 순서로 정렬한다", /places\.sort/.test(src));

console.log("\n[12] 판매지수 그래프에는 분야를 안 적는다");
// 판매지수는 서점이 책 한 권에 하나씩 매기는 값이라 분야와 무관합니다.
// 분야를 적으면 '분야마다 다른 지수' 라고 오해하게 됩니다.
check("순위일 때만 분야를 적는다", /const showCat = metric === "rank"/.test(src));
check("분야 표시가 showCat 에 묶여 있다", /showCat && \(/.test(src));

console.log();
if (bad) {
  console.log(`❌ ${bad}개 실패`);
  process.exit(1);
}
console.log("✅ 모두 통과");
