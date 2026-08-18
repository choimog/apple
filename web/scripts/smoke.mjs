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
  ["/best", ["종합 베스트셀러", "몇 개 서점에 올라야 넣을지"]],
  // '순위 밖' 과 '안 묶임' 의 뜻이 화면에 적혀 있는지 (2026-08-12 추가)
  ["/best", ["안 묶임"]],
  ["/best?period=weekly", ["주간"]],
  ["/store", ["서점별 순위", "집계 기간", "온라인 일간"]],
  ["/store?tab=weekly", ["집계 기간"]],
  ["/publishers", ["출판사별 순위", "점수는 어떻게 매기나요?"]],
  ["/authors", ["저자별 순위"]],
  ["/insights", ["어떤 분야가 종합 상위권을 채우고 있나"]],
  ["/search?q=%EC%86%8C%EC%84%A4", []],
  ["/status", ["수집 상태", "날짜별 · 서점별 수집 기록"]],
  // 리포트가 아직 없어도 화면은 떠야 합니다 ("아직 리포트가 없습니다")
  ["/report", ["오늘의 리포트"]],
  // 관리자가 아니면 "관리자만 볼 수 있습니다" 가 뜹니다. 둘 다 제목은 같습니다.
  ["/review", ["매칭 검토"]],
  // 점수 구간을 골랐을 때도 화면이 떠야 합니다.
  // (구간에 짝이 없으면 "…점 짝이 없습니다" 가 뜹니다 — 그것도 정상)
  ["/review?tab=pending&band=70", ["매칭 검토"]],
  // 모르는 값이 와도 빈 화면이 아니라 전체가 보여야 합니다
  ["/review?tab=merged&band=999", ["매칭 검토"]],
  // 묶인 권수로 좁혔을 때 (2026-08-09 추가)
  ["/review?tab=merged&size=large", ["매칭 검토"]],
  ["/review?tab=pending&size=small&band=70", ["매칭 검토"]],
  ["/review?tab=merged&size=엉터리", ["매칭 검토"]],
  // 엑셀로 한꺼번에 결정하기 안내가 보이는지 (2026-08-09 추가)
  ["/review", ["엑셀로 한꺼번에"]],
  // 강제로 묶기로 가는 길이 보이는지 (2026-08-12 추가)
  // 길이 없으면 기능을 만들어도 대표님이 못 찾으십니다.
  ["/review", ["강제로 묶기"]],
  // 관리자가 아니면 "관리자만 쓸 수 있습니다" 가 뜹니다. 제목은 같습니다.
  ["/review/join", ["강제로 묶기"]],
  // 찾은 것이 없어도 빈 화면이 아니라 안내가 떠야 합니다
  ["/review/join?q=%EC%97%86%EB%8A%94%EC%B1%85xyz", ["강제로 묶기"]],
  // 출판사 묶기 (2026-08-12 추가). 표가 아직 없어도 화면은 떠야 합니다.
  ["/review", ["출판사 묶기"]],
  ["/review/publishers", ["출판사 묶기"]],
  ["/review/publishers?q=%ED%95%9C%EB%B9%9B", ["출판사 묶기"]],
  ["/share", ["공유 링크"]],
  // 즐겨찾기 (2026-08-18 추가). db/favorites.sql 을 아직 안 돌렸으면
  // "아직 준비가 안 됐습니다" 가 뜹니다 — 그것도 정상 화면입니다.
  ["/favorites", ["즐겨찾기"]],
  ["/favorites?basis=top&period=weekly", ["즐겨찾기"]],
];

/**
 * 로그인 표(쿠키) 보관함.
 *
 * 【2026-08-09 회원 전용이 되면서 필요해졌습니다】
 * 이제 모든 화면이 로그인을 요구합니다. 그래서 검사 프로그램도 회원처럼
 * 로그인한 다음에 화면을 열어야 합니다. 안 그러면 전부 로그인 화면으로
 * 튕겨서, 화면이 깨졌는지 아닌지 알 수 없습니다.
 */
const jar = new Map();

function saveCookies(res) {
  const list = res.headers.getSetCookie?.() ?? [];
  for (const line of list) {
    const [pair] = line.split(";");
    const i = pair.indexOf("=");
    if (i < 0) continue;
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (value === "" || /expires=Thu, 01 Jan 1970/i.test(line)) jar.delete(name);
    else jar.set(name, value);
  }
}

function cookieHeader() {
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

/** 로그인 표를 붙여서 여는 fetch */
function get(path, init = {}) {
  return fetch(BASE + path, {
    ...init,
    headers: { ...(init.headers ?? {}), cookie: cookieHeader() },
  });
}

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

/* ---------------------------------------------------------------------------
   회원 전용 문지기가 실제로 서 있는지.

   ⚠️ 이건 로그인 계정이 없어도 반드시 확인합니다.
      문지기가 사라진 걸 모르고 지나가면, 사이트가 통째로 열린 채로
      운영됩니다. 눈으로는 알아챌 수 없습니다 — 대표님 브라우저는
      로그인이 되어 있어서 늘 정상으로 보입니다.
--------------------------------------------------------------------------- */
console.log("\n[회원 전용] 로그인 안 하면 못 들어가는지");
for (const path of ["/", "/best", "/status", "/book/1", "/review", "/share", "/report",
                    "/favorites"]) {
  try {
    const res = await fetch(BASE + path, {
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    const to = res.headers.get("location") ?? "";
    if (res.status >= 300 && res.status < 400 && to.includes("/login")) {
      ok(`${path} → 로그인 화면으로 보냄`);
    } else {
      bad(
        `🚨 ${path} 이(가) 로그인 없이 열립니다`,
        `HTTP ${res.status}${to ? ` → ${to}` : ""} · 문지기(middleware.ts)를 확인하세요`
      );
    }
  } catch (e) {
    bad(path, String(e?.message ?? e));
  }
}
/*
   공유 링크는 로그인 없이 열려야 합니다. 다만 **아무 주소나** 열리면 안 됩니다.
   엉터리 주소값에는 자료가 한 줄도 나오면 안 됩니다.
*/
{
  const res = await fetch(BASE + "/s/이건없는주소값", {
    signal: AbortSignal.timeout(30000),
  });
  const html = (await res.text()).replaceAll("<!-- -->", "");
  if (res.status === 200 && html.includes("열 수 없는 주소입니다")) {
    ok("/s/<엉터리> → 열 수 없다고 나옴 (로그인 화면으로 안 튕김)");
  } else {
    bad("/s/<엉터리>", `HTTP ${res.status} — 공유 링크가 로그인 화면으로 튕기면 못 씁니다`);
  }
}
{
  const res = await fetch(BASE + "/login", { signal: AbortSignal.timeout(30000) });
  const html = await res.text();
  if (res.status === 200 && html.includes("회원만 볼 수 있습니다")) ok("/login 이 열림");
  else bad("/login", `HTTP ${res.status} — 로그인 화면이 안 뜨면 아무도 못 들어옵니다`);
}

/* ---------------------------------------------------------------------------
   회원으로 로그인해서 화면을 열어봅니다.

   계정이 없으면 여기서 멈춥니다. 그래도 위 문지기 확인은 이미 했습니다.
--------------------------------------------------------------------------- */
const SMOKE_EMAIL = process.env.SMOKE_EMAIL;
const SMOKE_PASSWORD = process.env.SMOKE_PASSWORD;
let loggedIn = false;

if (SMOKE_EMAIL && SMOKE_PASSWORD) {
  console.log("\n[로그인] 검사용 계정으로 들어가기");
  try {
    const body = new URLSearchParams({
      email: SMOKE_EMAIL,
      password: SMOKE_PASSWORD,
      next: "/",
    });
    const res = await fetch(BASE + "/auth/login", {
      method: "POST",
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    saveCookies(res);
    const to = res.headers.get("location") ?? "";
    if (to.includes("error=")) {
      bad("로그인", `거절당했습니다 → ${to}`);
    } else if (!jar.size) {
      bad("로그인", "로그인 표(쿠키)를 못 받았습니다");
    } else {
      loggedIn = true;
      ok("로그인", SMOKE_EMAIL);
    }
  } catch (e) {
    bad("로그인", String(e?.message ?? e));
  }
}

if (!loggedIn) {
  console.log(
    "\n⏭️ 화면 내용 확인은 건너뜁니다.\n" +
      "   회원 전용이라 로그인해야 화면을 볼 수 있습니다.\n" +
      "   GitHub → Settings → Secrets → Actions 에 검사용 계정을 넣으면 켜집니다.\n" +
      "     SMOKE_EMAIL / SMOKE_PASSWORD\n" +
      "   (Supabase 에서 검사 전용 계정을 하나 만들어 쓰세요. 보기 전용이면 충분합니다)"
  );
  console.log("=".repeat(60));
  if (failed) {
    console.log(`❌ 실패 ${failed}건`);
    console.log("\n--- 사이트 로그 (마지막 부분) ---\n" + serverLog.slice(-3000));
    await shutdown(1);
  }
  console.log("✅ 문지기는 제대로 서 있습니다");
  await shutdown(0);
}

console.log("\n[화면] 실제 데이터로 하나씩 열어보기");
for (const [path, musts] of PAGES) {
  const started = Date.now();
  try {
    const res = await get(path, { signal: AbortSignal.timeout(30000) });
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
 * 하루치 수집 리포트가 실제로 열리는지.
 *
 * 날짜는 미리 적어 둘 수 없습니다(매일 바뀝니다). 그래서 수집 상태 화면에서
 * 실제 링크를 하나 뽑아 그 주소를 열어 봅니다.
 */
await (async () => {
  const name = "/status?date=… (하루치 리포트)";
  try {
    const html = await (await get("/status")).text();
    const m = html.match(/\/status\?date=(\d{4}-\d{2}-\d{2})/);
    if (!m) {
      console.log(`  ⏭️ ${name} — 아직 수집 기록이 없어 건너뜁니다`);
      return;
    }
    const res = await get(`/status?date=${m[1]}`, {
      signal: AbortSignal.timeout(30000),
    });
    const body = (await res.text()).replaceAll("<!-- -->", "");
    if (res.status !== 200) bad(name, `HTTP ${res.status}`);
    else if (body.includes("데이터를 불러오지 못했습니다"))
      bad(name, "‘데이터를 불러오지 못했습니다’ 화면이 떴습니다");
    else if (!body.includes("수집 리포트"))
      bad(name, "리포트 카드가 없습니다");
    else ok(name, m[1]);
  } catch (e) {
    bad(name, String(e?.message ?? e));
  }
})();

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
