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
  const filled = Array(SHEET_HEADER.length).fill("");
  filled[0] = 1;
  filled[1] = "같은책";
  const round = parseSheet(toCsv([...SHEET_HEADER], [filled, note]));
  check("반영할 줄은 1건뿐", round.rows.length === 1, round.rows);
  check("안내 줄은 '빈칸' 으로 넘어감", round.blank === 1, round.blank);
  check("'모르는 말' 로 세지 않음", round.unknown.length === 0, round.unknown);

  console.log("\n[3] 조금씩 흘려보내도 파일이 똑같다");
  // 한꺼번에 만들던 것을 줄 단위로 바꿨습니다. 결과가 달라지면 안 됩니다.
  const rows = [
    [1, "", "검토 대기", 90, 3, "교보문고", "아버지, 해방일지", "정지아", "창비",
     "2022-09", "예스24", "아버지, 해방일지", "정지아", "창비", "2022-09", "제목 같음"],
    [2, "", "검토 대기", 70, 2, "교보문고", '따옴표"있음', "저자", "민음사", "",
     "예스24", "따옴표\"있음", "저자", "민음사", "", ""],
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
  // 🚨 일부만 세면 3권 묶인 책이 '2권' 으로 나옵니다. 빈칸보다 나쁩니다.
  check("다 못 세면 틀린 숫자 대신 '모른다' 로 넘어간다",
    /> SIZE_SCAN_CAP\)\s*\{[\s\S]{0,120}ok: false/.test(lib));

  console.log("\n[5-1] 🚨 뒤로 갈수록 느려지지 않는다 (29,502줄에서 끊긴 원인)");
  // "29,000번째부터" 로 물으면 데이터베이스가 매번 앞 29,000줄을 다시
  // 셉니다. 뒤로 갈수록 느려져 시간 제한에 걸립니다.
  check("전체 받기는 '마지막 번호 다음부터' 로 읽는다",
    lib.includes('.gt("id", after)'), );
  check("어디까지 읽었는지 기억한다",
    /after\s*=\s*got\[got\.length - 1\]\.id/.test(lib));
  check("조건을 걸고 받을 때는 점수순을 유지한다",
    lib.includes('tab === "mine" ? "decided_at" : "score"'));
  // 같은 점수가 수백 개라 순서가 흔들리면 어떤 줄은 두 번, 어떤 줄은 빠집니다
  check("같은 점수끼리도 순서가 안 흔들리게 번호로 한 번 더 줄 세운다",
    /"score".*\n[\s\S]{0,200}?\.order\("id", \{ ascending: true \}\)[\s\S]{0,80}\.range\(/.test(lib));

  console.log("\n[6] 잘렸으면 조용히 넘어가지 않는다");
  check("잘림 표시가 있다", route.includes("status.capped"));
  check("잘렸다고 파일 안에 적는다", route.includes("건까지만 담았습니다"));
  check("도중에 끊기면 파일 안에 적는다", route.includes("전부가 아닙니다"));
  check("한 건도 없으면 그렇다고 적는다", route.includes("해당하는 짝이 없습니다"));
  // 🚨 흘려보내는 중에는 오류 화면으로 못 바꿉니다. 끝 표시가 유일한 증거입니다.
  check("파일 맨 끝에 '여기까지가 전부' 를 적는다",
    route.includes("여기까지가 전부입니다"));

  console.log("\n[7] 2026-08-10 요청 — 세 가지를 갯수 제한 없이 한 번에");
  check("tab=all 을 받아들인다", route.includes('raw === "all"'));
  check("세 가지를 모두 담는다",
    /ALL_TABS[^\n]*=[^\n]*"pending"[^\n]*"merged"[^\n]*"mine"/.test(route));
  check("전체일 때는 줄 수 제한이 없다", route.includes("all ? Infinity"));
  check("전체일 때는 점수·권수 조건을 걸지 않는다",
    route.includes("all ? null : parseBand") && route.includes("all ? null : parseSize"));
  check("어느 칸에서 온 줄인지 적는다", SHEET_HEADER.includes("구분"));
  check("'구분' 은 결정 바로 뒤 (앞 두 칸은 그대로)",
    SHEET_HEADER[0] === "짝번호" && SHEET_HEADER[1] === "결정" &&
    SHEET_HEADER[2] === "구분", SHEET_HEADER.slice(0, 3));

  console.log("\n[8] 🚨 올리기도 파일을 통째로 보내지 않는다 (413 PAYLOAD_TOO_LARGE)");
  // 파일 통째로 올리기는 4.5MB 에서 서버 앞단이 거절합니다.
  // 우리 코드가 실행되기도 전이라 안내 문구조차 못 띄웁니다.
  const imp = readFileSync("app/review/import/chunk/route.ts", "utf8");
  const impUi = readFileSync("components/ImportSheet.tsx", "utf8");
  check("파일을 올리는 폼이 없다",
    !readFileSync("app/review/page.tsx", "utf8").includes('action="/review/import"'));
  check("브라우저가 파일을 읽는다", impUi.includes("parseSheet"));
  check("짝번호와 결정만 나눠 보낸다",
    impUi.includes("/review/import/chunk") && impUi.includes("JSON.stringify"));
  check("한 번에 보내는 건수를 정해 뒀다", /PER_CALL\s*=\s*\d+/.test(impUi));
  check("서버도 한 번에 받는 양을 막는다", /MAX_PER_CALL\s*=\s*\d+/.test(imp));
  check("올리기도 시간 제한을 늘려 두었다",
    /export const maxDuration\s*=\s*\d+/.test(imp));
  check("이상한 값이 섞이면 한 건도 반영 안 한다",
    imp.includes("짝번호가 이상합니다") && imp.includes("모르는 결정"));
  check("막혀서 0줄 바뀐 것을 성공으로 세지 않는다",
    imp.includes("failed += ids.length - n"));
  check("엉뚱한 파일이면 보내기 전에 멈춘다",
    /parsed\.fatal[\s\S]{0,80}return;/.test(impUi));
  check("도중에 멈추면 어디까지 반영됐는지 말한다",
    impUi.includes("이미 반영됐습니다"));
  check("몇 건 반영·건너뜀·실패인지 숫자로 보여준다",
    impUi.includes("건 반영했습니다") && impUi.includes("반영 안 됨"));

  console.log("\n[9] 🚨 전체 받기는 브라우저가 나눠서 가져온다 (두 번 잘린 뒤)");
  // 29,502줄 · 36,002줄에서 두 번 잘렸습니다. 서버가 한 번에 다 만들려는
  // 구조였기 때문입니다. 자료가 늘면 언젠가 또 걸립니다.
  const comp = readFileSync("components/ExportAll.tsx", "utf8");
  const chunk = readFileSync("app/review/sheet/chunk/route.ts", "utf8");
  check("나눠 가져오는 주소가 있다", chunk.includes("getExportChunk"));
  check("이어받을 번호를 돌려준다", chunk.includes("next"));
  check("브라우저가 여러 번 부른다", comp.includes("/review/sheet/chunk?tab="));
  check("어디까지 왔는지 보여준다", comp.includes("지금까지"));
  // 🚨 한 조각이라도 실패하면 반쪽 파일을 저장하면 안 됩니다
  check("실패하면 파일을 안 만든다",
    comp.includes("throw new Error") && /catch[\s\S]{0,200}setError/.test(comp));
  check("실패했다고 화면에 알린다", comp.includes("저장하지 않았습니다"));
  check("끝 표시는 그대로 넣는다", comp.includes("여기까지가 전부입니다"));
  check("조각이 실패하면 서버도 오류로 답한다",
    chunk.includes("status: 500") && chunk.includes("관리자만"));

  console.log("\n[9-1] 🚨 화면에서 찾아 놓고 받으면 찾은 것만 담긴다 (2026-08-11)");
  // 화면에는 3건인데 파일에는 3만 건이 들어 있으면, 그 파일이 무엇인지
  // 알 수 없습니다. 화면과 파일은 반드시 같아야 합니다.
  const rpage = readFileSync("app/review/page.tsx", "utf8");
  check("검색 상자가 있다", rpage.includes('name="q"') && rpage.includes("찾기"));
  check("내려받기 링크에 검색어를 붙인다", rpage.includes("${qQ}"));
  check("내려받기가 검색어를 읽는다", route.includes('q.get("q")'));
  check("검색어를 목록 함수에 넘긴다",
    /streamReviewPairs\(tabs\[0\], band, size, maxRows, firstStatus, find\)/.test(route));
  check("파일 이름에 검색어를 적는다", route.includes("_검색_"));
  check("찾은 것이 없으면 한 줄도 안 담는다",
    /if \(!found\.ids\.length\) return;/.test(lib));
  // 🚨 너무 많이 걸리면 앞쪽만 봅니다. 조용히 자르면 안 됩니다.
  check("너무 많으면 잘렸다고 표시한다",
    lib.includes("if (found.capped) status.capped = true"));
  check("화면에도 잘렸다고 적는다", rpage.includes("searchCapped"));
  check("검색 중에는 점수·권수 필터를 끈다",
    rpage.includes("searching ? null : band") && rpage.includes("!searching && scoreBands"));

  console.log("\n[10] 묶인 권수를 표 전체를 훑지 않고 센다");
  check("이 조각에 나오는 책만 센다", lib.includes("groupSizesFor"));
  check("못 세면 빈칸 (틀린 숫자 대신)", /catch \{[\s\S]{0,120}return null;/.test(lib));

  console.log();
  if (bad) {
    console.log(`❌ ${bad}개 실패`);
    process.exit(1);
  }
  console.log("✅ 모두 통과");
} finally {
  rmSync(out, { recursive: true, force: true });
}
