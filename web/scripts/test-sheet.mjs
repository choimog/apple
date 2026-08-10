/**
 * 매칭 검토 엑셀 읽기 규칙 시험.
 *
 * 【왜 이게 가장 중요한 시험인가요?】
 * 이 기능은 한 번에 수백 건을 바꿉니다. 잘못 읽어도 화면에는 "완료" 만
 * 뜹니다. 특히 위험한 두 가지:
 *
 *   · 엉뚱한 파일을 올렸는데 조용히 0건 반영하고 "완료" 라고 하는 것
 *   · 제목에 쉼표가 든 책(『아버지, 해방일지』) 때문에 칸이 밀려서
 *     엉뚱한 짝에 결정이 들어가는 것
 *
 * 실행: node scripts/test-sheet.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = mkdtempSync(join(tmpdir(), "sheettest-"));
let bad = 0;

function check(name, ok, got) {
  if (ok) console.log(`  ✅ ${name}`);
  else {
    console.log(`  ❌ ${name}${got !== undefined ? `\n       나온 값: ${JSON.stringify(got)}` : ""}`);
    bad++;
  }
}

try {
  execFileSync(
    "npx",
    ["tsc", "lib/review-sheet.ts", "--outDir", out, "--module", "esnext",
     "--target", "es2020", "--moduleResolution", "bundler"],
    { stdio: "inherit" }
  );
  const { parseSheet, splitCsvLine, SHEET_HEADER } =
    await import(join(out, "review-sheet.js"));

  const HEAD = SHEET_HEADER.join(",");

  console.log("\n[1] 🚨 엉뚱한 파일이면 한 줄도 반영하지 않는다");
  // "완료" 라고 뜨는데 아무것도 안 바뀐 상태가 가장 위험합니다.
  const wrong = parseSheet("날짜,구분,순위\n2026-08-09,종합,1");
  check("멈춘다 (fatal)", !!wrong.fatal, wrong.fatal);
  check("반영할 줄이 하나도 없다", wrong.rows.length === 0);
  check("왜 안 되는지 말한다", (wrong.fatal || "").includes("짝번호"), wrong.fatal);

  check("빈 파일도 멈춘다", !!parseSheet("").fatal);

  console.log("\n[2] 제대로 채운 파일을 읽는다");
  const good = parseSheet(
    `${HEAD}\n` +
    `101,같은책,88,3,교보문고,가,저자,민음사,2024-01,예스24,가,저자,민음사,2024-01,제목 같음\n` +
    `102,다른책,70,2,교보문고,나,저자,창비,2024-02,예스24,나,저자,창비,2024-03,출간월 다름\n` +
    `103,,66,3,교보문고,다,저자,문학동네,2024-03,예스24,다,저자,문학동네,2024-03,\n`
  );
  check("2건을 읽는다", good.rows.length === 2, good.rows);
  check("101 은 같은책", good.rows[0].action === "merge", good.rows[0]);
  check("102 는 다른책", good.rows[1].action === "split", good.rows[1]);
  check("빈칸은 건너뜀 (오류 아님)", good.blank === 1, good.blank);
  check("모르는 말 없음", good.unknown.length === 0);

  console.log("\n[3] 🚨 제목에 쉼표가 있어도 칸이 안 밀린다");
  // 『아버지, 해방일지』 같은 제목이 실제로 있습니다.
  // 칸이 밀리면 **엉뚱한 짝에 결정이 들어갑니다.**
  const comma = parseSheet(
    `${HEAD}\n` +
    `201,같은책,90,3,교보문고,"아버지, 해방일지",정지아,창비,2022-09,예스24,"아버지, 해방일지",정지아,창비,2022-09,제목 같음\n`
  );
  check("한 줄로 제대로 읽는다", comma.rows.length === 1, comma.rows);
  check("짝번호가 201", comma.rows[0]?.id === 201, comma.rows[0]);
  check("결정이 같은책", comma.rows[0]?.action === "merge", comma.rows[0]);

  const cells = splitCsvLine('1,같은책,"아버지, 해방일지",창비');
  check("따옴표 안 쉼표는 칸 구분이 아니다",
    cells[2] === "아버지, 해방일지", cells);

  console.log("\n[4] 여러 가지 표기를 알아듣는다");
  for (const [word, want] of [
    ["같은 책", "merge"], ["O", "merge"], ["ㅇ", "merge"], ["1", "merge"],
    ["다른 책", "split"], ["X", "split"], ["2", "split"],
    ["되돌리기", "undo"], ["취소", "undo"],
  ]) {
    const r = parseSheet(`${HEAD}\n9,${word},,,,,,,,,,,,,`);
    check(`'${word}' → ${want}`, r.rows[0]?.action === want, r.rows[0]);
  }

  console.log("\n[5] 모르는 말은 조용히 넘기지 않는다");
  // '아마도' 같은 말을 적으셨을 때 그냥 무시하면, 반영된 줄 알고 계십니다.
  const un = parseSheet(`${HEAD}\n5,아마도,,,,,,,,,,,,,\n6,같은책,,,,,,,,,,,,,`);
  check("모르는 말을 센다", un.unknown.length === 1, un.unknown);
  check("몇 번째 줄인지 알려준다", un.unknown[0]?.line === 2, un.unknown);
  check("나머지 줄은 그대로 반영", un.rows.length === 1, un.rows);

  console.log("\n[6] 짝번호가 이상하면 세어서 알려준다");
  const bid = parseSheet(`${HEAD}\n안녕,같은책,,,,,,,,,,,,,\n7,같은책,,,,,,,,,,,,,`);
  check("이상한 짝번호를 센다", bid.badId.length === 1, bid.badId);
  check("정상인 줄은 반영", bid.rows.length === 1, bid.rows);

  console.log("\n[7] 같은 짝을 두 번 적으면 나중 것을 쓴다");
  // 엑셀에서 위쪽에 적었다가 아래에서 고쳐 적는 일이 있습니다.
  const dup = parseSheet(`${HEAD}\n8,같은책,,,,,,,,,,,,,\n8,다른책,,,,,,,,,,,,,`);
  check("한 건만 남는다", dup.rows.length === 1, dup.rows);
  check("나중에 적은 '다른책' 이 이긴다",
    dup.rows[0]?.action === "split", dup.rows[0]);

  console.log("\n[8] 엑셀이 붙이는 보이지 않는 글자(BOM)를 견딘다");
  // 우리가 만든 파일에도 BOM 이 붙습니다 (lib/csv.ts). 못 읽으면
  // 우리가 준 파일을 우리가 못 읽는 꼴이 됩니다.
  const bom = parseSheet(`﻿${HEAD}\n11,같은책,,,,,,,,,,,,,`);
  check("BOM 이 있어도 읽는다", !bom.fatal && bom.rows.length === 1, bom);

  console.log("\n[9] 줄바꿈 방식이 달라도 읽는다");
  const crlf = parseSheet(`${HEAD}\r\n12,같은책,,,,,,,,,,,,,\r\n`);
  check("윈도우 줄바꿈(CRLF)", crlf.rows.length === 1, crlf.rows);

  console.log();
  if (bad) {
    console.log(`❌ ${bad}개 실패`);
    process.exit(1);
  }
  console.log("✅ 모두 통과");
} finally {
  rmSync(out, { recursive: true, force: true });
}
