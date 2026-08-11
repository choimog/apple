/**
 * '몇 위까지 보나' 기본값 시험.
 *
 * 【왜 이 시험이 생겼나요? — 2026-08-11 전체 점검에서 찾음】
 * 대표님 결정으로 **일간 300위 · 주간 500위**까지 모읍니다.
 * 그런데 화면은 기간과 상관없이 300위까지만 보고 있었습니다.
 * 주간 301~500위는 **모아 놓고 한 번도 안 쓰는 자료**였습니다.
 *
 * 서점에 요청을 보내 받아 온 자료를 안 쓰는 것은 그냥 낭비가 아니라,
 * 대표님이 "주간은 500위까지" 라고 정하신 것이 지켜지지 않는 것입니다.
 * 그리고 화면에는 "300위 안에 없습니다" 라고 적히니 **틀린 말**입니다.
 *
 * 모으는 기준(config/sources.yaml)과 보는 기준이 어긋나면 여기서 잡습니다.
 *
 * 실행: node scripts/test-depth.mjs
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

console.log("\n[1] 기간에 따라 깊이가 달라지는가");
const src = q.slice(q.indexOf("export function defaultDepth"));
const body = src.slice(src.indexOf("{") + 1, src.indexOf("\n}"));
const defaultDepth = new Function("period", body.replace(/:\s*number/g, ""));

check("일간은 300위", defaultDepth("daily") === 300, defaultDepth("daily"));
check("주간은 500위", defaultDepth("weekly") === 500, defaultDepth("weekly"));

console.log("\n[2] 🚨 모으는 기준과 같은 숫자인가 (config/sources.yaml)");
// 여기가 어긋나면, 모아 놓고 안 쓰거나 없는 순위를 기다리게 됩니다.
const yaml = readFileSync("../config/sources.yaml", "utf8");

let section = null;
const caps = { daily: new Set(), weekly: new Set() };
for (const line of yaml.split("\n")) {
  const sec = line.match(/^([a-z0-9_]+):\s*$/);
  if (sec) section = sec[1];
  const mi = line.match(/^\s*max_items:\s*(\d+)/);
  if (mi && section && section !== "defaults") {
    caps[section.endsWith("_weekly") ? "weekly" : "daily"].add(Number(mi[1]));
  }
}

const maxDaily = Math.max(...caps.daily, 0);
const maxWeekly = Math.max(...caps.weekly, 0);
check(`일간 설정 최대 ${maxDaily}위 = 화면 ${defaultDepth("daily")}위`,
  maxDaily === defaultDepth("daily"), { 설정: maxDaily, 화면: defaultDepth("daily") });
check(`주간 설정 최대 ${maxWeekly}위 = 화면 ${defaultDepth("weekly")}위`,
  maxWeekly === defaultDepth("weekly"), { 설정: maxWeekly, 화면: defaultDepth("weekly") });

console.log("\n[3] 쓰는 곳마다 이 값을 쓰는가");
// 한 곳이라도 300 을 그대로 적어 두면 주간에서 조용히 어긋납니다.
check("종합 순위", /const depth = opts\.depth \?\? defaultDepth\(period\)/.test(q));
check("출판사·저자 순위", (q.match(/defaultDepth\(period\)/g) || []).length >= 3,
  (q.match(/defaultDepth\(period\)/g) || []).length);
const detail = readFileSync("components/NameDetailPage.tsx", "utf8");
check("출판사·저자 상세 화면", /defaultDepth\(period\)/.test(detail));
check("300 을 그대로 적어 둔 곳이 없다",
  !/const depth = 300/.test(q + detail));

console.log();
if (bad) {
  console.log(`❌ ${bad}개 실패`);
  process.exit(1);
}
console.log("✅ 모두 통과");
