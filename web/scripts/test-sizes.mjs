/**
 * 묶음 크기(몇 권이 묶였나) 구분 시험.
 *
 * 【왜 시험이 필요한가요?】
 * 서점이 셋이라 **3권이 정상**입니다. 여기서 벗어난 것을 찾자는 기능인데,
 * 경계가 어긋나면 정작 찾아야 할 것이 '정상' 칸에 숨습니다.
 * 특히 4권 이상은 **한 서점에서 두 권이 묶였다**는 뜻이라 가장 중요합니다.
 *
 * 실행: node scripts/test-sizes.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = mkdtempSync(join(tmpdir(), "sizetest-"));
let bad = 0;

function check(name, ok, got) {
  if (ok) console.log(`  ✅ ${name}`);
  else {
    console.log(`  ❌ ${name}${got !== undefined ? `\n       나온 값: ${JSON.stringify(got)}` : ""}`);
    bad++;
  }
}

try {
  // 실제 파일에서 규칙 부분만 잘라 씁니다 (베끼면 한쪽만 고쳐집니다)
  const src = readFileSync("lib/review.ts", "utf8");
  const s = src.indexOf("export type SizeGroup");
  const e = src.indexOf("/* ══════════════════════════════════════════════════ 점수 구간");
  if (s < 0 || e < 0 || e <= s) {
    throw new Error("lib/review.ts 에서 묶음 크기 규칙을 못 찾았습니다 (이름이 바뀌었나요?)");
  }
  writeFileSync(join(out, "sizes.ts"), src.slice(s, e));

  execFileSync(
    "npx",
    ["tsc", join(out, "sizes.ts"), "--outDir", out, "--module", "esnext",
     "--target", "es2020", "--moduleResolution", "bundler"],
    { stdio: "inherit" }
  );

  const { sizeGroupOf, parseSize, SIZE_LABEL, SIZE_HELP } =
    await import(join(out, "sizes.js"));

  console.log("\n[1] 서점이 셋이므로 3권이 정상");
  check("3권 → 정상(exact)", sizeGroupOf(3) === "exact", sizeGroupOf(3));

  console.log("\n[2] 2권 이하 — 한 서점을 놓쳤을 수 있음");
  check("2권 → small", sizeGroupOf(2) === "small", sizeGroupOf(2));
  check("1권 → small", sizeGroupOf(1) === "small", sizeGroupOf(1));
  // 0권은 실제로는 안 나오지만, 들어와도 '정상' 으로 새면 안 됩니다
  check("0권 → small", sizeGroupOf(0) === "small", sizeGroupOf(0));

  console.log("\n[3] 🚨 4권 이상 — 한 서점에서 두 권이 묶였다는 뜻");
  // 이 기능의 존재 이유입니다. 여기가 새면 잘못 묶인 책을 못 찾습니다.
  check("4권 → large", sizeGroupOf(4) === "large", sizeGroupOf(4));
  check("5권 → large", sizeGroupOf(5) === "large", sizeGroupOf(5));
  check("30권 → large", sizeGroupOf(30) === "large", sizeGroupOf(30));

  console.log("\n[4] 빈틈도 겹침도 없는지");
  const seen = {};
  for (let n = 0; n <= 50; n++) {
    const g = sizeGroupOf(n);
    if (!["small", "exact", "large"].includes(g)) {
      check(`${n}권이 어느 칸에도 없음`, false, g);
    }
    seen[g] = true;
  }
  check("세 칸이 전부 쓰인다", Object.keys(seen).length === 3, Object.keys(seen));

  console.log("\n[5] 주소에 이상한 값이 와도 안전한지");
  check("모르는 값 → 전체(null)", parseSize("엉터리") === null);
  check("빈 값 → 전체(null)", parseSize(undefined) === null);
  check("아는 값 → 그대로", parseSize("large") === "large");

  console.log("\n[6] 설명이 다 있는지");
  // 버튼만 있고 설명이 없으면 '4권 이상' 이 왜 문제인지 알 수 없습니다.
  for (const g of ["small", "exact", "large"]) {
    check(`'${g}' 이름이 있다`, !!SIZE_LABEL[g], SIZE_LABEL[g]);
    check(`'${g}' 설명이 있다`, !!SIZE_HELP[g], SIZE_HELP[g]);
  }

  console.log();
  if (bad) {
    console.log(`❌ ${bad}개 실패`);
    process.exit(1);
  }
  console.log("✅ 모두 통과");
} finally {
  rmSync(out, { recursive: true, force: true });
}
