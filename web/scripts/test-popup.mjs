/**
 * 하루 한 번 뜨는 리포트 창 규칙 시험.
 *
 * 【왜 시험이 필요한가요?】
 * 이 규칙은 **틀려도 화면이 멀쩡해 보입니다.**
 * "안 뜬다" 가 정상인지 고장인지 구분이 안 되기 때문에, 몇 주 동안
 * 리포트를 아무도 못 봐도 모르고 지나갈 수 있습니다.
 *
 * 특히 위험한 실수 하나를 못박아 둡니다:
 *   '오늘 날짜' 로 세면 안 됩니다. 리포트는 아침 7시 반쯤 나옵니다.
 *   그보다 일찍 들어와 창을 닫으면, 그날 리포트는 영영 못 보게 됩니다.
 *
 * 실행: node scripts/test-popup.mjs   (lib/popup.ts 를 그때그때 변환해서 씁니다)
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = mkdtempSync(join(tmpdir(), "popuptest-"));
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
  // 실제 소스를 그대로 변환해서 씁니다.
  // 시험용으로 베껴 쓰면 나중에 한쪽만 고쳐져도 통과해 버립니다.
  execFileSync(
    "npx",
    ["tsc", "lib/popup.ts", "--outDir", out, "--module", "esnext",
     "--target", "es2020", "--moduleResolution", "bundler"],
    { stdio: "inherit" }
  );

  const { shouldShow, POPUP_KEY } = await import(join(out, "popup.js"));

  console.log("\n[1] 처음 오신 분에게는 뜹니다");
  check("본 적 없음 → 뜸", shouldShow(null, "2026-08-10") === true);
  check("빈 값이어도 뜸", shouldShow("", "2026-08-10") === true);

  console.log("\n[2] 같은 리포트를 두 번 띄우지 않습니다");
  check("이미 본 리포트 → 안 뜸", shouldShow("2026-08-10", "2026-08-10") === false);

  console.log("\n[3] 다음 날 리포트가 나오면 다시 뜹니다");
  check("어제 것만 봤음 → 뜸", shouldShow("2026-08-09", "2026-08-10") === true);

  console.log("\n[4] 리포트가 없으면 아무것도 안 뜹니다");
  // 리포트를 아직 안 켜셨거나, 그날 수집이 실패한 경우입니다.
  // 빈 창이 뜨면 "고장났나?" 하게 됩니다.
  check("리포트 없음 → 안 뜸", shouldShow(null, null) === false);
  check("리포트 없음(빈 글자) → 안 뜸", shouldShow("2026-08-09", "") === false);

  console.log("\n[5] '오늘 날짜' 가 아니라 '리포트 날짜' 로 세는지");
  // 🚨 여기가 이 시험의 핵심입니다.
  //    아침 7시(리포트 나오기 전)에 들어와 창을 닫았다고 칩시다.
  //    그때 저장된 값이 '어제 리포트 날짜' 여야 합니다.
  //    만약 '오늘 날짜' 를 저장하는 구조였다면, 8시에 오늘 리포트가
  //    나와도 "오늘은 봤다" 가 되어 못 봅니다.
  const 어제리포트 = "2026-08-09";
  const 오늘리포트 = "2026-08-10";
  check(
    "어제 것 닫은 뒤, 오늘 리포트가 나오면 다시 뜸",
    shouldShow(어제리포트, 오늘리포트) === true
  );
  check(
    "오늘 것 닫은 뒤에는 안 뜸",
    shouldShow(오늘리포트, 오늘리포트) === false
  );

  console.log("\n[6] 기록해 두는 이름이 정해져 있는지");
  // 이름이 바뀌면 모든 분에게 창이 한 번 더 뜹니다 (고장은 아니지만 성가심)
  check("기록 이름 = report-seen", POPUP_KEY === "report-seen", POPUP_KEY);

  console.log();
  if (bad) {
    console.log(`❌ ${bad}개 실패`);
    process.exit(1);
  }
  console.log("✅ 모두 통과");
} finally {
  rmSync(out, { recursive: true, force: true });
}
