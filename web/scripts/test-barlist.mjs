/**
 * 🚨 막대 그림에서 '줄 세우는 값' 과 '보여주는 값' 이 같은지 봅니다.
 *
 * 【2026-08-12 대표님 지적】
 *   "왜 순위가 종수에 비례하지 않고 마구잡이로 나열되어 있는지 물어본 거였어.
 *    아침에는 정상적이었는데, 몇 번 다시 돌리니까 뒤죽박죽이 됐네."
 *
 * 웰컴의 [출판사 TOP 8] · [저자 TOP 8] 은 데이터베이스가 **점수 순**으로
 * 보내 준 것을 그 순서대로 늘어놓습니다. 그런데 화면에 찍는 숫자와 막대
 * 길이는 **종수** 를 쓰고 있었습니다. 둘이 다른 값이라 이렇게 됩니다.
 *
 *     1  민음사     8종   ▓▓▓▓
 *     2  문학동네  14종   ▓▓▓▓▓▓▓▓     ← 2등 막대가 더 김
 *
 * BarList 는 받은 순서대로 1,2,3… 을 매기고 value 로 막대를 그립니다.
 * 그러니 **정렬 기준과 value 가 반드시 같아야** 합니다.
 *
 * 실행: node scripts/test-barlist.mjs
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

/** 파일에서 <BarList … /> 덩어리를 다 뽑아냅니다 */
function barLists(src) {
  const out = [];
  let at = 0;
  for (;;) {
    const s = src.indexOf("<BarList", at);
    if (s < 0) break;
    const e = src.indexOf("/>", s);
    out.push(src.slice(s, e));
    at = e + 2;
  }
  return out;
}

const home = readFileSync("app/page.tsx", "utf8");
const insights = readFileSync("app/insights/page.tsx", "utf8");
const perf = readFileSync("../db/perf.sql", "utf8");

console.log("\n[1] 데이터베이스는 무엇을 기준으로 줄을 세우는가");
// publisher_ranking / author_ranking 의 마지막 ORDER BY 는 4번 칸(=score)입니다.
// RETURNS TABLE (name, books, best_rank, score, top_titles)
for (const fn of ["publisher_ranking", "author_ranking"]) {
  const body = perf.slice(perf.indexOf(`FUNCTION public.${fn}(`));
  const head = body.slice(0, body.indexOf("$$;"));
  check(`${fn} 은 4번 칸(점수) 순서로 보낸다`,
    /ORDER BY 4 DESC/.test(head));
}
const share = perf.slice(perf.indexOf("FUNCTION public.category_share("));
check("category_share 는 3번 칸(권수) 순서로 보낸다",
  /ORDER BY 3 DESC/.test(share.slice(0, share.indexOf("$$;"))));

console.log("\n[2] 🚨 화면이 그 기준을 그대로 보여주는가");
const homeBars = barLists(home);
check("웰컴에 막대 그림이 3개 있다 (출판사·저자·분야)", homeBars.length === 3,
  homeBars.length);

const [pubBar, authorBar, shareBar] = homeBars;
check("출판사 — 점수로 막대를 그린다",
  /value:\s*r\.score/.test(pubBar) && /unit="점"/.test(pubBar));
check("🚨 출판사 — 종수로 막대를 그리지 않는다 (점수 순인데 종수를 그리면 뒤죽박죽)",
  !/value:\s*r\.books/.test(pubBar));
check("출판사 — 종수는 아랫줄에 그대로 보여 준다", /sub:/.test(pubBar) && /r\.books/.test(pubBar));

check("저자 — 점수로 막대를 그린다",
  /value:\s*r\.score/.test(authorBar) && /unit="점"/.test(authorBar));
check("🚨 저자 — 종수로 막대를 그리지 않는다", !/value:\s*r\.books/.test(authorBar));
check("저자 — 종수는 아랫줄에 그대로 보여 준다", /sub:/.test(authorBar) && /r\.books/.test(authorBar));

check("분야 — 권수 순서라 권수로 그리는 것이 맞다",
  /value:\s*r\.books/.test(shareBar) && /unit="권"/.test(shareBar));

const insightBars = barLists(insights);
check("분야 자세히 보기 — 권수 순서라 권수로 그린다",
  insightBars.length === 1 && /value:\s*r\.books/.test(insightBars[0]));

console.log("\n[3] [전체 →] 화면과 순서가 어긋나지 않는가");
// 웰컴에서 8개만 보다가 [전체 →] 를 눌렀는데 순서가 달라지면 안 됩니다.
const full = readFileSync("components/NameRankingPage.tsx", "utf8");
check("전체 화면도 점수를 앞에 내세운다", /r\.score\.toLocaleString\(\)/.test(full));
check("전체 화면도 순서를 바꾸지 않고 받은 대로 쓴다",
  !/rows[\s\S]{0,40}\.sort\(/.test(full));

console.log();
if (bad) {
  console.log(`❌ ${bad}개 실패`);
  process.exit(1);
}
console.log("✅ 모두 통과");
