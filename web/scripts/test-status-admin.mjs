/**
 * 수집 상태 화면이 관리자 전용인지 시험 — 2026-08-19 대표님 요청
 *
 *   "수집 상태 영역도 관리자만 볼 수 있도록 바꿔줄 수 있어?"
 *
 * 【왜 시험이 필요한가요?】
 * 권한은 **틀려도 화면이 멀쩡해 보입니다.** 대표님은 관리자라서
 * 언제나 정상으로 보이고, 회원에게 열려 있어도 아무 표시가 안 납니다.
 * 눈으로는 절대 확인할 수 없는 종류입니다.
 *
 * 🚨 그리고 문이 **두 개**입니다. 하나만 잠그면 잠근 척이 됩니다.
 *
 *     문 1  화면            app/status/page.tsx
 *     문 2  데이터베이스     db/auth.sql 의 "관리자만 읽기"
 *
 * 문 2 가 왜 필요한가: 공개용 열쇠는 브라우저 안에 그대로 들어 있어서,
 * 사이트를 안 거치고 데이터베이스에 직접 물어볼 수 있습니다.
 * 화면만 막으면 그 길이 그대로 열려 있습니다.
 *
 * ※ 여기서는 '규칙이 코드에 적혀 있는가' 만 봅니다.
 *   **정말로 막히는지**는 tests/test_auth_sql.sh 가 진짜 데이터베이스를
 *   띄워서 회원인 척하고 직접 물어봅니다. 둘 다 있어야 합니다.
 *
 * 실행: node scripts/test-status-admin.mjs
 */

import { readFileSync } from "node:fs";

let bad = 0;
function check(name, ok, got) {
  if (ok) console.log(`  ✅ ${name}`);
  else {
    console.log(
      `  ❌ ${name}${got !== undefined ? `\n       나온 값: ${JSON.stringify(got)}` : ""}`
    );
    bad++;
  }
}

const page = readFileSync("app/status/page.tsx", "utf8");
const nav = readFileSync("components/Nav.tsx", "utf8");
const auth = readFileSync("../db/auth.sql", "utf8");
const queries = readFileSync("lib/queries.ts", "utf8");

// ---------------------------------------------------------------------------
console.log("\n[1] 문 1 — 화면이 관리자를 확인하는가");

check("권한을 물어본다", /currentRole/.test(page));
check(
  '관리자가 아니면 되돌려보낸다',
  /currentRole\(\)\)\s*!==\s*"admin"/.test(page),
  page.match(/currentRole[^\n]*/g)
);
/*
  🚨 확인은 **자료를 읽기 전에** 해야 합니다.
     뒤에 두면 관리자가 아닌 사람의 접속에도 조회가 다 나갑니다.
     막히기는 해도 쓸데없이 자료를 건드리고, 무엇보다 순서가 어긋나면
     나중에 누가 조회 하나를 위로 옮겼을 때 조용히 새어 나갑니다.
*/
check(
  "확인이 자료를 읽기 **전**에 있다",
  page.indexOf('!== "admin"') < page.indexOf("getCrawlSummary("),
  { 확인: page.indexOf('!== "admin"'), 조회: page.indexOf("getCrawlSummary(") }
);
check("왜 막는지 사람 말로 적어 준다", /관리자만 볼 수 있습니다/.test(page));
// 막아 놓고 아무 말도 안 하면 '고장난 화면' 으로 보입니다.
check(
  "순위 보는 데에는 지장 없다고 알려 준다",
  /지장이\s*\n?\s*없습니다/.test(page)
);

// ---------------------------------------------------------------------------
console.log("\n[2] 메뉴에서도 감추는가");

const adminBlock = nav.slice(
  nav.indexOf("const ADMIN_GROUP"),
  nav.indexOf("\n};", nav.indexOf("const ADMIN_GROUP"))
);
check("[수집 상태] 가 관리 묶음에 있다", adminBlock.includes('"/status"'));
check(
  "일반 묶음에는 없다",
  !nav.slice(0, nav.indexOf("const ADMIN_GROUP")).includes('"/status"'),
  "일반 묶음에 두면 회원 메뉴에 떠서 눌러도 막히기만 합니다"
);
check("관리 묶음은 관리자에게만 붙는다", /isAdmin \? \[\.\.\.GROUPS, ADMIN_GROUP\]/.test(nav));

// ---------------------------------------------------------------------------
console.log("\n[3] 🚨 문 2 — 데이터베이스도 막는가 (여기가 진짜입니다)");

const adminTables = auth.slice(auth.indexOf("② 관리자만 볼 수 있는 표"));
check(
  "수집 기록(crawl_logs)이 관리자 전용 무리에 있다",
  /ARRAY\['crawl_logs', 'archives'\]/.test(auth),
  auth.match(/FOREACH t IN ARRAY ARRAY\[[^\]]*\]/g)
);
check(
  "회원 무리에는 더 이상 없다",
  !/'rankings', 'book_meta', 'crawl_logs'/.test(auth)
);
check('규칙이 is_admin() 을 쓴다', /"관리자만 읽기".*USING \(is_admin\(\)\)/.test(adminTables));

/*
  🚨 이게 이 변경에서 가장 놓치기 쉬운 곳입니다.

  보안 규칙은 여러 개가 있으면 **하나라도 통과하면 보입니다.**
  이 표들은 예전에 "회원만 읽기 USING (true)" 를 달고 있었습니다.
  새 규칙만 만들고 그 옛 규칙을 안 지우면, 회원은 그대로 다 봅니다.
  (tests/test_auth_sql.sh 의 [3-2] 가 실제로 되살려 놓고 확인합니다)
*/
check(
  "옛 '회원만 읽기' 규칙을 지운다",
  /DROP POLICY IF EXISTS "회원만 읽기"/.test(adminTables)
);
check(
  "is_admin() 이 이 무리보다 먼저 만들어진다",
  auth.indexOf("CREATE OR REPLACE FUNCTION is_admin") <
    auth.indexOf("② 관리자만 볼 수 있는 표"),
  "뒤에 있으면 실행이 '함수가 없습니다' 로 멈춥니다"
);
check(
  "is_admin() 은 한 군데에서만 만든다",
  (auth.match(/CREATE OR REPLACE FUNCTION is_admin/g) || []).length === 1,
  auth.match(/CREATE OR REPLACE FUNCTION is_admin/g)
);

// ---------------------------------------------------------------------------
console.log("\n[4] 확인표가 새 규칙을 확인하는가");
// 안내표가 옛 기준으로 보면, 잘 잠근 날에도 ❌ 가 뜹니다.
// 그러면 대표님은 ❌ 를 무시하게 됩니다 — 그게 제일 위험합니다.
check("'관리자만 보이는 표' 줄이 있다", /관리자만 보이는 표/.test(auth));
check(
  "회원 통과 규칙은 is_admin 조건을 빼고 센다",
  /NOT LIKE '%is_admin%'/.test(auth),
  "안 빼면 관리자 전용 표까지 '회원이 봄' 으로 세어져 늘 ❌ 가 됩니다"
);

// ---------------------------------------------------------------------------
console.log("\n[5] 회원 화면이 이 자료를 실수로 쓰지 않는가");
/*
  crawl_logs 를 읽는 함수가 회원용 화면에 쓰이면, 오류 없이
  **빈 목록**이 돌아옵니다. 화면은 멀쩡한데 아무것도 안 나옵니다 —
  이 프로젝트에서 가장 위험한 종류의 고장입니다.
*/
check(
  "안 쓰는 crawl_logs 조회 함수를 없앴다",
  !/export async function getRecentCrawlStatus/.test(queries)
);
check("없앤 이유를 적어 뒀다", /getRecentCrawlStatus/.test(queries));

// 이 두 함수를 부르는 곳은 관리자 화면(app/status) 하나뿐이어야 합니다.
for (const fn of ["getCrawlSummary", "getCrawlDetail", "getArchivedRange"]) {
  const users = [];
  for (const f of [
    "app/page.tsx",
    "app/best/page.tsx",
    "app/store/page.tsx",
    "app/favorites/page.tsx",
    "app/search/page.tsx",
    "app/insights/page.tsx",
    "app/report/page.tsx",
    "app/layout.tsx",
  ]) {
    if (readFileSync(f, "utf8").includes(fn)) users.push(f);
  }
  check(`${fn}() 을 회원 화면에서 안 쓴다`, users.length === 0, users);
}

// ---------------------------------------------------------------------------
console.log();
if (bad) {
  console.log(`❌ ${bad}개 실패`);
  process.exit(1);
}
console.log("✅ 모두 통과");
