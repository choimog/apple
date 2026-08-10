/**
 * 매칭 검토 '엑셀로 내려받기' 시험.
 *
 * 【2026-08-10 대표님 신고】
 * "엑셀 파일 다운로드 버튼을 눌렀는데 페이지가 한참 로딩중인 것처럼
 *  나오다가 결국 사이트 에러창이 떴다"
 *
 * 원인은 파일 크기가 아니라 **데이터베이스를 4,000번 넘게 부른 것**이었습니다.
 * 화면용 함수(20줄짜리)를 100번 불렀고, 그때마다 '몇 권 묶였나' 를
 * 처음부터 다시 셌습니다.
 *
 * 이 시험은 그게 **다시 그렇게 되지 않는지** 봅니다.
 * 이런 종류의 되돌아감은 눈으로 보면 멀쩡해 보이기 때문에 시험이 필요합니다.
 *
 * 실행: node scripts/test-export.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = mkdtempSync(join(tmpdir(), "exporttest-"));
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
    ["tsc", "lib/review-sheet.ts", "lib/csv.ts", "--outDir", out, "--module", "esnext",
     "--target", "es2020", "--moduleResolution", "bundler"],
    { stdio: "inherit" }
  );
  const { SHEET_HEADER, noteRow, parseSheet } =
    await import(join(out, "review-sheet.js"));
  const { csvLine, toCsv, CSV_BOM } = await import(join(out, "csv.js"));

  console.log("\n[1] 안내 문구 줄이 칸을 밀지 않는다");
  // 칸 수가 하나라도 모자라면 엑셀에서 표가 어긋나 보입니다.
  const note = noteRow("⚠️ 앞쪽 2000건만 받았습니다");
  check("칸 수가 머리글과 같다", note.length === SHEET_HEADER.length,
    { note: note.length, head: SHEET_HEADER.length });
  check("짝번호 칸은 비어 있다", note[0] === "", note[0]);
  check("결정 칸도 비어 있다", note[1] === "", note[1]);

  console.log("\n[2] 🚨 안내 문구를 우리가 다시 읽어도 사고가 안 난다");
  // 이 파일을 그대로 다시 올리실 수 있습니다. 안내 줄이 '결정' 으로
  // 읽히면 엉뚱한 짝이 바뀝니다.
  const round = parseSheet(
    toCsv([...SHEET_HEADER], [[1, "같은책", 90, 3, "", "", "", "", "", "", "", "", "", "", ""], note])
  );
  check("반영할 줄은 1건뿐", round.rows.length === 1, round.rows);
  check("안내 줄은 '빈칸' 으로 넘어감", round.blank === 1, round.blank);
  check("'모르는 말' 로 세지 않음", round.unknown.length === 0, round.unknown);

  console.log("\n[3] 조금씩 흘려보내도 파일이 똑같다");
  // 한꺼번에 만들던 것을 줄 단위로 바꿨습니다. 결과가 달라지면 안 됩니다.
  const rows = [
    [1, "", 90, 3, "교보문고", "아버지, 해방일지", "정지아", "창비", "2022-09",
     "예스24", "아버지, 해방일지", "정지아", "창비", "2022-09", "제목 같음"],
    [2, "", 70, 2, "교보문고", '따옴표"있음', "저자", "민음사", "", "예스24",
     "따옴표\"있음", "저자", "민음사", "", ""],
  ];
  const whole = toCsv([...SHEET_HEADER], rows);
  const streamed =
    CSV_BOM + [csvLine([...SHEET_HEADER]), ...rows.map(csvLine)].join("\r\n");
  check("한꺼번에 만든 것과 글자 하나까지 같다", whole === streamed);
  check("쉼표 든 제목은 따옴표로 감싼다", whole.includes('"아버지, 해방일지"'));
  check("따옴표는 두 번 적어 피한다", whole.includes('""있음'));

  console.log("\n[4] 🚨 내려받기가 화면용 함수를 다시 쓰지 않는다");
  // 여기로 되돌아가면 대표님이 겪으신 오류가 그대로 재현됩니다.
  const route = readFileSync("app/review/sheet/route.ts", "utf8");
  check("한꺼번에 훑는 함수를 쓴다", route.includes("streamReviewPairs"));
  check("20줄짜리 화면용 함수를 안 쓴다", !route.includes("getReviewPairs("), );
  check("쪽수를 세며 도는 반복문이 없다", !/for\s*\(\s*let\s+page/.test(route));
  check("조금씩 흘려보낸다", route.includes("ReadableStream"));
  check("시간 제한을 늘려 두었다", /export const maxDuration\s*=\s*\d+/.test(route));

  console.log("\n[5] 🚨 '몇 권 묶였나' 를 한 번만 센다");
  const lib = readFileSync("lib/review.ts", "utf8");
  const body = lib.slice(lib.indexOf("export async function* streamReviewPairs"));
  const calls = (body.match(/await groupSizes\(\)/g) ?? []).length;
  check("내려받기에서 딱 한 번만 센다", calls === 1, calls);
  check("세는 것을 동시에 한다 (줄 서서 기다리지 않음)",
    lib.includes("Promise.all") && lib.includes("LANES"));
  check("번호를 나눠서 물어본다 (주소가 너무 길어지지 않게)",
    lib.includes("ID_CHUNK"));

  console.log("\n[6] 잘렸으면 조용히 넘어가지 않는다");
  check("잘림 표시가 있다", route.includes("status.capped"));
  check("잘렸다고 파일 안에 적는다", route.includes("건만 받았습니다"));
  check("도중에 끊기면 파일 안에 적는다", route.includes("전부가 아닙니다"));
  check("한 건도 없으면 그렇다고 적는다", route.includes("해당하는 짝이 없습니다"));

  console.log();
  if (bad) {
    console.log(`❌ ${bad}개 실패`);
    process.exit(1);
  }
  console.log("✅ 모두 통과");
} finally {
  rmSync(out, { recursive: true, force: true });
}
