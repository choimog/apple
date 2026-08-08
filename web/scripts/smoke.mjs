/**
 * 실제 데이터로 모든 화면을 한 번씩 열어봅니다.
 *
 * 【왜 필요한가요? — 2026-08-08】
 * `next build` 가 통과해도 화면이 멀쩡하다는 뜻은 아닙니다.
 * 빌드는 가짜 접속 정보로 돌기 때문에, 조회문이 실제로 도는지는 확인하지
 * 않습니다. 실제로 이번 개편에서 화면 12개를 새로 만들었는데, 빌드만으로는
 * "열었을 때 오류 화면이 뜨는지" 를 알 수 없었습니다.
 *
 * 그래서 진짜 열쇠로 사이트를 띄우고, 모든 주소를 실제로 열어
 *   · 200 으로 응답하는지
 *   · '데이터를 불러오지 못했습니다' 오류 화면이 아닌지
 *   · 화면마다 있어야 할 문구가 실제로 들어 있는지
 * 를 확인합니다.
 *
 * ※ 이 파일은 GitHub Actions 안에서만 돕니다. 배포되는 사이트에는 안 들어갑니다.
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = process.env.SMOKE_PORT || "3123";
const BASE = `http://127.0.0.1:${PORT}`;

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.log(
    "\nℹ️ 화면 열어보기를 건너뜁니다.\n" +
      "   GitHub → Settings → Secrets → Actions 에 SUPABASE_ANON_KEY 를 등록하면\n" +
      "   실제 데이터로 모든 화면을 열어보는 확인이 켜집니다."
  );
  process.exit(0);
}

/** 열어볼 주소와, 그 화면에 반드시 있어야 할 문구 */
const PAGES = [
  ["/", ["오늘의 베스트셀러", "종합 베스트셀러 TOP 10"]],
  ["/best", ["종합 베스트셀러", "이 순위는 어떻게 계산했나요?"]],
  ["/best?period=weekly", ["주간"]],
  ["/store", ["서점별 순위", "1. 서점"]],
  ["/store?tab=weekly", ["집계 기간"]],
  ["/publishers", ["출판사별 순위", "점수는 어떻게 매기나요?"]],
  ["/authors", ["저자별 순위"]],
  ["/insights", ["어떤 분야가 종합 상위권을 채우고 있나", "이 숫자를 읽는 법"]],
  ["/search?q=%EC%86%8C%EC%84%A4", []],
  ["/status", ["수집 상태"]],
];

const server = spawn("npx", ["next", "start", "-p", PORT], {
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(BASE, { signal: AbortSignal.timeout(3000) });
      if (r.status) return true;
    } catch {
      /* 아직 안 떴습니다 */
    }
    await sleep(1000);
  }
  return false;
}

let failed = 0;
const ok = (m, d = "") => console.log(`  ✅ ${m}${d ? " — " + d : ""}`);
const bad = (m, d) => {
  console.log(`  ❌ ${m}\n       ${d}`);
  failed += 1;
};

console.log("\n실제 데이터로 모든 화면 열어보기\n" + "=".repeat(60));

if (!(await waitForServer())) {
  console.log("❌ 사이트가 뜨지 않았습니다.\n" + serverLog.slice(-3000));
  server.kill("SIGTERM");
  process.exit(1);
}

for (const [path, musts] of PAGES) {
  const started = Date.now();
  try {
    const res = await fetch(BASE + path, { signal: AbortSignal.timeout(30000) });
    // React 는 서버에서 그릴 때 "{word}별 순위" 처럼 값이 끼어든 문구 사이에
    // <!-- --> 주석을 넣습니다. 사람 눈에는 안 보이지만 문자열 검사는 실패합니다.
    // 그래서 주석을 지우고 비교합니다.
    // (이것 때문에 멀쩡한 화면 2개가 실패로 잡혔습니다 — 2026-08-08)
    const html = (await res.text()).replaceAll("<!-- -->", "");
    const ms = Date.now() - started;

    if (res.status !== 200) {
      bad(path, `HTTP ${res.status}`);
      continue;
    }
    // 오류 화면이 떴는지 (데이터가 없는 것과 못 불러온 것은 다릅니다)
    if (html.includes("데이터를 불러오지 못했습니다")) {
      bad(path, "‘데이터를 불러오지 못했습니다’ 화면이 떴습니다");
      continue;
    }
    const missing = musts.filter((m) => !html.includes(m));
    if (missing.length) {
      bad(path, `있어야 할 문구가 없습니다: ${missing.join(", ")}`);
      continue;
    }
    // 느린 화면도 알려줍니다 (실패는 아님)
    const slow = ms > 3000 ? ` ⏱️ 느림` : "";
    ok(path, `${ms}ms${slow}`);
  } catch (e) {
    bad(path, String(e?.message ?? e));
  }
}

/**
 * 확인이 끝나면 사이트를 확실히 내리고 이 파일도 끝냅니다.
 *
 * 【왜 이렇게까지 하나요? — 2026-08-08 실제로 겪은 문제】
 * 예전에는 kill(SIGTERM) 만 부르고 끝냈는데, next start 가 바로 안 죽으면
 * 자식 프로세스가 살아 있어 이 파일이 영영 안 끝났습니다. 확인은 다 끝나고
 * 결과도 다 찍혔는데 프로세스만 매달려 있었습니다.
 * GitHub Actions 에서 이러면 작업이 제한시간까지 멈춰 있게 됩니다.
 */
async function shutdown(code) {
  server.kill("SIGTERM");
  // 3초를 줘도 안 죽으면 강제로 내립니다
  const dead = await Promise.race([
    new Promise((r) => server.once("exit", () => r(true))),
    sleep(3000).then(() => false),
  ]);
  if (!dead) server.kill("SIGKILL");
  process.exit(code);
}

console.log("=".repeat(60));
if (failed) {
  console.log(`❌ 실패 ${failed}건 — 배포하면 그 화면이 깨져 보입니다.`);
  console.log("\n--- 사이트 로그 (마지막 부분) ---\n" + serverLog.slice(-3000));
  await shutdown(1);
}
console.log("✅ 모든 화면 정상");
await shutdown(0);
