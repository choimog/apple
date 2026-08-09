/**
 * "며칠째 자료가 안 들어왔나" 판단 시험.
 *
 * 【왜 시험이 필요한가요?】
 * 이 경고는 **이 시스템에서 유일하게, 아무 신호도 안 나는 고장**을 잡습니다.
 * GitHub 은 저장소에 오래 아무 변경이 없으면 예약 작업을 스스로 끄는데,
 * 그러면 실패가 아니라 아예 안 돌아서 빨간 X 도 메일도 없습니다.
 *
 * 그래서 이 판단이 틀리면 두 가지 중 하나가 됩니다.
 *   · 너무 늦게 뜬다  → 몇 주 동안 자료가 안 쌓인 걸 모릅니다
 *   · 너무 자주 뜬다  → 매일 뜨는 경고는 아무도 안 봅니다. 진짜일 때도요.
 *
 * 실행: node scripts/test-stale.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = mkdtempSync(join(tmpdir(), "staletest-"));
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
  // 실제 소스를 그대로 변환해서 씁니다 (베껴 두면 한쪽만 고쳐져도 통과합니다)
  execFileSync(
    "npx",
    ["tsc", "lib/stale.ts", "--outDir", out, "--module", "esnext",
     "--target", "es2020", "--moduleResolution", "bundler"],
    { stdio: "inherit" }
  );

  const { staleness, kstToday, WARN_DAYS, BAD_DAYS } =
    await import(join(out, "stale.js"));

  const 오늘 = "2026-08-11";
  const lvl = (latest) => staleness(latest, 오늘)?.level;

  console.log("\n[1] 정상일 때는 아무것도 안 띄웁니다");
  // 수집은 06:00 에 시작해 07:30 쯤 끝납니다. 그 전에는 어제 것이 최신입니다.
  // 여기서 경고가 뜨면 **매일 아침 경고를 보게 됩니다.**
  check("오늘 자료 → 정상", lvl("2026-08-11") === "ok", lvl("2026-08-11"));
  check("어제 자료 → 정상 (아침 수집 전)", lvl("2026-08-10") === "ok", lvl("2026-08-10"));

  console.log("\n[2] 하루 걸렀을 때는 노란 주의");
  check("2일 전 → 주의", lvl("2026-08-09") === "warn", lvl("2026-08-09"));

  console.log("\n[3] 이틀 넘게 안 들어오면 빨간 경고");
  check("3일 전 → 위험", lvl("2026-08-08") === "bad", lvl("2026-08-08"));
  check("10일 전 → 위험", lvl("2026-08-01") === "bad", lvl("2026-08-01"));
  // 🚨 예약 작업이 꺼진 경우가 이 모습입니다 (60일 넘게 조용)
  check("60일 전 → 위험", lvl("2026-06-12") === "bad", lvl("2026-06-12"));

  console.log("\n[4] 며칠인지 정확히 세는지");
  // 화면에 "3일째" 라고 적히므로 이 숫자가 틀리면 화면이 거짓말을 합니다.
  check("2026-08-08 → 3일", staleness("2026-08-08", 오늘).days === 3,
        staleness("2026-08-08", 오늘).days);
  check("달을 넘겨도 맞음 (7/31 → 11일)",
        staleness("2026-07-31", 오늘).days === 11,
        staleness("2026-07-31", 오늘).days);
  check("해를 넘겨도 맞음 (2025-12-31 → 223일)",
        staleness("2025-12-31", 오늘).days === 223,
        staleness("2025-12-31", 오늘).days);

  console.log("\n[5] 판단할 수 없으면 지어내지 않습니다");
  // ⚠️ '자료를 못 읽음' 을 '자료가 없음' 으로 바꿔 보여주면,
  //    데이터베이스가 잠깐 느린 것도 큰일처럼 보입니다.
  check("자료 없음 → 판단 안 함(null)", staleness(null, 오늘) === null);
  check("빈 값 → 판단 안 함(null)", staleness("", 오늘) === null);

  console.log("\n[6] 앞날 날짜가 와도 경고하지 않습니다");
  // 시계가 어긋나거나 시간대 계산이 틀리면 생길 수 있습니다.
  // 여기서 경고를 띄우면 원인을 찾을 수 없는 경고가 됩니다.
  check("내일 날짜 → 정상", lvl("2026-08-12") === "ok", lvl("2026-08-12"));

  console.log("\n[7] 오늘 날짜를 한국시간으로 보는지");
  // ⚠️ 서버는 세계표준시로 돕니다. 그냥 계산하면 한국 기준 오전 9시 전에
  //    '어제' 가 나와서, 멀쩡한 자료가 하루 늦은 것으로 보입니다.
  //    한국시간 2026-08-11 오전 2시 = 세계표준시 2026-08-10 17시
  const 새벽 = new Date("2026-08-10T17:00:00Z");
  check("한국 새벽 2시 → 2026-08-11", kstToday(새벽) === "2026-08-11", kstToday(새벽));
  // 한국시간 2026-08-11 밤 11시 = 세계표준시 2026-08-11 14시
  const 밤 = new Date("2026-08-11T14:00:00Z");
  check("한국 밤 11시 → 2026-08-11", kstToday(밤) === "2026-08-11", kstToday(밤));

  console.log("\n[8] 기준 날짜 수");
  check("주의는 2일", WARN_DAYS === 2, WARN_DAYS);
  check("위험은 3일", BAD_DAYS === 3, BAD_DAYS);
  check("주의가 위험보다 먼저", WARN_DAYS < BAD_DAYS);

  console.log();
  if (bad) {
    console.log(`❌ ${bad}개 실패`);
    process.exit(1);
  }
  console.log("✅ 모두 통과");
} finally {
  rmSync(out, { recursive: true, force: true });
}
