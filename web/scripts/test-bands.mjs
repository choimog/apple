/**
 * 점수 구간(5점 단위) 규칙 시험.
 *
 * 【왜 시험이 필요한가요?】
 * 구간 나누기는 **틀려도 화면이 멀쩡해 보입니다.**
 * 경계가 하나 어긋나면 어떤 짝은 어느 구간에도 안 들어가서 그냥 사라집니다.
 * 목록은 정상적으로 보이고, 없어진 짝이 있다는 것만 아무도 모릅니다.
 * 검토 화면에서 그런 일이 나면 **잘못 묶인 책을 영영 못 찾습니다.**
 *
 * 실행: node scripts/test-bands.mjs   (lib/review.ts 의 규칙만 떼어 시험)
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const out = mkdtempSync(join(tmpdir(), "bandtest-"));
let bad = 0;

function check(name, ok, got) {
  if (ok) {
    console.log(`  ✅ ${name}`);
  } else {
    console.log(`  ❌ ${name}${got !== undefined ? `\n       나온 값: ${JSON.stringify(got)}` : ""}`);
    bad++;
  }
}

try {
  // lib/review.ts 는 데이터베이스에 붙는 코드가 섞여 있어 통째로는 못 돌립니다.
  // 구간 규칙 부분만 떼어내서 시험합니다.
  //
  // ⚠️ 베껴 쓰지 않고 **실제 파일에서 잘라냅니다.** 베껴 두면 나중에
  //    한쪽만 고쳐져도 시험이 통과해 버립니다.
  const src = readFileSync("lib/review.ts", "utf8");
  const start = src.indexOf("export const BAND_STEP");
  const end = src.indexOf("export async function getScoreBands");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(
      "lib/review.ts 에서 구간 규칙 부분을 못 찾았습니다.\n" +
      "       (BAND_STEP ~ getScoreBands 사이를 잘라 씁니다. 이름이 바뀌었나요?)"
    );
  }
  writeFileSync(join(out, "bands.ts"), src.slice(start, end));

  execFileSync(
    "npx",
    ["tsc", join(out, "bands.ts"), "--outDir", out, "--module", "esnext",
     "--target", "es2020", "--moduleResolution", "bundler"],
    { stdio: "inherit" }
  );

  const { BAND_STARTS, BAND_STEP, bandRange, bandLabel, parseBand } =
    await import(join(out, "bands.js"));

  console.log("\n[1] 5점 단위인지");
  check("한 칸 = 5점", BAND_STEP === 5, BAND_STEP);
  for (const s of BAND_STARTS.slice(0, -1)) {
    const { lo, hiExclusive } = bandRange(s);
    check(`${s}점 칸이 5점짜리`, hiExclusive - lo === 5, [lo, hiExclusive]);
  }

  console.log("\n[2] 빈틈이 없는지 — 어느 점수도 사라지면 안 됩니다");
  // 🚨 여기가 핵심입니다. 한 점수라도 어느 칸에도 안 들어가면
  //    그 짝은 화면에서 그냥 없어집니다. 아무도 모릅니다.
  const missing = [];
  const doubled = [];
  for (let score = 60; score <= 100; score++) {
    const hit = BAND_STARTS.filter((s) => {
      const { lo, hiExclusive } = bandRange(s);
      return score >= lo && score < hiExclusive;
    });
    if (hit.length === 0) missing.push(score);
    if (hit.length > 1) doubled.push(score);
  }
  check("60~100점이 전부 어느 칸엔가 들어감", missing.length === 0, missing);
  check("두 칸에 겹쳐 들어가는 점수 없음", doubled.length === 0, doubled);

  console.log("\n[3] 100점(ISBN 이 같아 확정된 짝)이 빠지지 않는지");
  // ISBN 이 같으면 점수가 100 으로 고정됩니다 (crawler/common/match.py).
  // 마지막 칸을 95~99 로 만들면 이 짝들이 통째로 사라집니다.
  const last = bandRange(BAND_STARTS[BAND_STARTS.length - 1]);
  check("100점이 마지막 칸에 들어감", 100 >= last.lo && 100 < last.hiExclusive, last);
  check("마지막 칸 이름이 '95~100점'", bandLabel(95) === "95~100점", bandLabel(95));

  console.log("\n[4] 이름이 실제 범위와 맞는지");
  // 이름이 '65~70점' 인데 실제로 70점이 다음 칸이면 화면이 거짓말을 합니다.
  for (const s of BAND_STARTS) {
    const { hiExclusive } = bandRange(s);
    check(`${s}점 칸 이름 = ${s}~${hiExclusive - 1}점`,
          bandLabel(s) === `${s}~${hiExclusive - 1}점`, bandLabel(s));
  }

  console.log("\n[5] 주소에 이상한 값이 와도 안전한지");
  // 남이 보낸 주소나 오타로 엉뚱한 값이 들어올 수 있습니다.
  // 그때 '아무것도 없음' 이 아니라 '전체' 로 보여야 합니다.
  check("모르는 값 → 전체(null)", parseBand("999") === null);
  check("글자 → 전체(null)", parseBand("abc") === null);
  check("빈 값 → 전체(null)", parseBand(undefined) === null);
  check("아는 값 → 그 구간", parseBand("70") === 70, parseBand("70"));

  console.log("\n[6] 실제로 쓰이는 범위를 덮는지");
  // config/matching.yaml 기준: 검토 대기 65~84 · 자동 묶음 85~100
  const covers = (n) => BAND_STARTS.some((s) => {
    const { lo, hiExclusive } = bandRange(s);
    return n >= lo && n < hiExclusive;
  });
  check("검토 대기 아래끝 65점", covers(65));
  check("검토 대기 위끝 84점", covers(84));
  check("자동 묶음 아래끝 85점", covers(85));
  check("자동 묶음 위끝 100점", covers(100));

  console.log();
  if (bad) {
    console.log(`❌ ${bad}개 실패`);
    process.exit(1);
  }
  console.log("✅ 모두 통과");
} finally {
  rmSync(out, { recursive: true, force: true });
}
