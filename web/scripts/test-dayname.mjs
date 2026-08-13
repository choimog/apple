/**
 * 🚨 요일이 하루씩 밀리지 않는지 봅니다.
 *
 * 【2026-08-12 대표님 지적】
 *   "수집하는 일자는 표기가 맞는데, 요일 표기가 하루씩 밀려서
 *    표기되는거 같은데? 그래서 사이트 전체적으로 그렇게 잘못된
 *    요일로 표기되는거 같아."
 *
 * 맞았습니다. 예전 코드는 이랬습니다.
 *
 *     const d = new Date(`${iso}T00:00:00+09:00`);   // 한국 자정을 만들고
 *     ... d.getUTCDay()                             // UTC 기준 요일을 읽음
 *
 * 한국 자정은 세계표준시로는 **전날 15시**입니다. 그래서 언제나
 * **하루 전 요일**이 나왔습니다. 8월 12일(수) → '화'.
 *
 * 🚨 이런 종류는 눈으로 못 잡습니다. 날짜는 맞고 요일만 틀리기 때문에
 *    달력을 직접 대조하지 않으면 그냥 지나갑니다. 그래서 기계가 봅니다.
 *
 * 실행: node scripts/test-dayname.mjs
 * ※ 인터넷도 DB 도 필요 없습니다.
 */

import { readFileSync } from "node:fs";
import { dayLabel, shortDay } from "../lib/format.ts";

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

console.log("\n[1] 🚨 달력과 대조 — 손으로 확인한 날짜들");
// 실제 달력에서 확인한 값입니다. 여기가 틀리면 사이트 전체가 틀립니다.
const CALENDAR = [
  ["2026-08-10", "8월 10일 (월)"],
  ["2026-08-11", "8월 11일 (화)"],
  ["2026-08-12", "8월 12일 (수)"], // ← 대표님이 지적하신 날. 예전엔 '화' 였습니다
  ["2026-08-13", "8월 13일 (목)"],
  ["2026-08-14", "8월 14일 (금)"],
  ["2026-08-15", "8월 15일 (토)"], // 광복절
  ["2026-08-16", "8월 16일 (일)"],
  ["2026-01-01", "1월 1일 (목)"],
  ["2024-02-29", "2월 29일 (목)"], // 윤년
  ["2025-12-31", "12월 31일 (수)"],
];
for (const [iso, want] of CALENDAR) {
  const got = dayLabel(iso);
  check(`${iso} → ${want}`, got === want, got);
}

console.log("\n[2] 🚨 일곱 요일이 한 바퀴 다 돌아야 합니다");
// 하루씩 밀리면 이 검사만으로는 안 걸립니다(전부 한 칸씩 밀려도 일곱 개니까요).
// 그래서 위 [1] 의 달력 대조가 진짜 검사이고, 이건 빠진 요일이 없는지만 봅니다.
const week = new Set();
for (let i = 0; i < 7; i++) {
  const d = new Date(Date.UTC(2026, 7, 10 + i));
  week.add(dayLabel(d.toISOString().slice(0, 10)).slice(-2, -1));
}
check("월·화·수·목·금·토·일 이 모두 나온다", week.size === 7, [...week]);

console.log("\n[3] 🚨 시간대를 만들어 쓰지 않는가 (이게 원인이었습니다)");
const f = readFileSync("lib/format.ts", "utf8");
const fn = f.slice(f.indexOf("export function dayLabel"));
const body = fn.slice(0, fn.indexOf("\n}\n"));
check("🚨 '+09:00' 같은 시각을 만들지 않는다",
  !/\+09:00/.test(body),
  "달력 날짜에 시간대를 씌우면 그 순간부터 어긋납니다");
check("Date.UTC 로 시간대 영향을 없앤다", /Date\.UTC\(/.test(body));
check("요일 배열은 한 군데만 있다",
  (f.match(/"일", "월", "화"/g) || []).length === 1,
  "여러 군데 있으면 한쪽만 고치게 됩니다");

console.log("\n[4] 이상한 값이 와도 화면이 안 깨진다");
for (const junk of ["", "엉터리", "2026-08", "2026-13-99"]) {
  let got;
  try {
    got = dayLabel(junk);
  } catch (e) {
    got = `던짐: ${e?.message}`;
  }
  check(`${JSON.stringify(junk)} → 죽지 않는다`, typeof got === "string", got);
}
check("2026-08 처럼 모자란 값은 그대로 돌려준다", dayLabel("2026-08") === "2026-08");

console.log("\n[5] 짧은 표기는 그대로");
check("2026-08-12 → 08-12", shortDay("2026-08-12") === "08-12", shortDay("2026-08-12"));

console.log();
if (bad) {
  console.log(`❌ ${bad}개 실패`);
  process.exit(1);
}
console.log("✅ 모두 통과");
