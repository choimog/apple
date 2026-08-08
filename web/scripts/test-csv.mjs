/**
 * 엑셀 내려받기 규칙 시험.
 *
 * 【왜 시험이 필요한가요?】
 * CSV 는 조용히 망가집니다. 제목에 쉼표가 하나 들어가면 그 줄부터 칸이
 * 통째로 밀리는데, 파일은 정상적으로 열립니다. 열어보고도 모릅니다.
 * 그래서 규칙을 시험으로 못박아 둡니다.
 *
 * 실행: node scripts/test-csv.mjs   (lib/csv.ts 를 그때그때 변환해서 씁니다)
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = mkdtempSync(join(tmpdir(), "csvtest-"));
try {
  // 실제 소스(lib/csv.ts)를 그대로 변환해서 시험합니다.
  // 시험용으로 따로 베껴 쓰면 나중에 한쪽만 고쳐져도 통과해 버립니다.
  execFileSync(
    "npx",
    ["tsc", "lib/csv.ts", "--outDir", out, "--module", "esnext",
     "--target", "es2020", "--moduleResolution", "bundler"],
    { stdio: "inherit" }
  );

  const { toCsv, safeFileName } = await import(join(out, "csv.js"));

  let bad = 0;
  const check = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`  ${ok ? "✅" : "❌"} ${name}`);
    if (!ok) {
      console.log(`      나온 값: ${JSON.stringify(got)}`);
      console.log(`      기대 값: ${JSON.stringify(want)}`);
      bad += 1;
    }
  };

  console.log("\n엑셀 내려받기 규칙\n" + "=".repeat(60));

  check("맨 앞에 BOM 이 붙는다 (엑셀 한글 깨짐 방지)",
    toCsv(["날짜"], [["2026-08-08"]]).charCodeAt(0), 0xfeff);

  check("쉼표가 든 값은 따옴표로 감싼다 — 안 그러면 칸이 밀립니다",
    toCsv(["제목"], [["코스모스, 100만부"]]).slice(1),
    '제목\r\n"코스모스, 100만부"');

  check("따옴표는 두 번 적어 처리한다",
    toCsv(["제목"], [['그는 "말했다"']]).slice(1),
    '제목\r\n"그는 ""말했다"""');

  check("줄바꿈이 든 값도 따옴표로 감싼다",
    toCsv(["a"], [["1\n2"]]).slice(1), 'a\r\n"1\n2"');

  // 교보문고는 판매지수를 공개하지 않습니다. 0 으로 채우면 '0점'으로 읽힙니다.
  check("값이 없으면 빈 칸 (0 으로 채우지 않는다)",
    toCsv(["판매지수"], [[null]]).slice(1), "판매지수\r\n");
  check("undefined 도 빈 칸", toCsv(["a"], [[undefined]]).slice(1), "a\r\n");
  check("숫자 0 은 0 으로 (빈 칸이 아님)",
    toCsv(["a"], [[0]]).slice(1), "a\r\n0");

  check("줄 구분은 CRLF (엑셀 표준)",
    toCsv(["a"], [["1"], ["2"]]).slice(1), "a\r\n1\r\n2");

  check("파일 이름의 / 를 _ 로 (‘소설/시/희곡’ 같은 제목)",
    safeFileName("소설/시/희곡_순위이력"), "소설_시_희곡_순위이력");
  check("파일 이름의 : * ? 도 바꾼다",
    safeFileName('a:b*c?d"e<f>g|h'), "a_b_c_d_e_f_g_h");
  check("빈 이름이면 기본값", safeFileName(""), "download");

  console.log("=".repeat(60));
  if (bad) {
    console.log(`❌ 실패 ${bad}건`);
    process.exit(1);
  }
  console.log("✅ 엑셀 내려받기 규칙 전부 통과");
} finally {
  rmSync(out, { recursive: true, force: true });
}
