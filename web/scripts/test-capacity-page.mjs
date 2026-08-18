/**
 * 🚨 [저장 용량] 화면이 조용히 거짓말하지 않는지 봅니다.
 *
 * 【2026-08-18 대표님 요청】
 *   "혹시 남은 저장용량을 사이트에 올려서 확인할 수 있나?
 *    매칭 검토처럼 관리자 페이지에 말이지."
 *
 * 이 화면은 **틀려도 멀쩡해 보입니다.** 숫자가 그럴듯하게 차 있으면
 * 사람은 맞다고 믿습니다. 위험한 곳이 셋입니다.
 *
 *   ① 계산을 여기에 또 만드는 것
 *      crawler/capacity.py 맨 위: "같은 계산을 두 군데 두면 반드시
 *      어긋납니다. 한쪽만 고치게 되니까요." 한 번 옮겨 온 계산입니다.
 *      2026-08-18 하루에만 그 계산을 두 번 고쳤습니다.
 *
 *   ② 999 를 '999일 남음' 으로 적는 것
 *      999 는 capacity.py 에서 **'한도에 닿지 않는다'** 는 뜻입니다.
 *
 *   ③ '못 쟀음' 을 0 으로 적는 것
 *      0 으로 보이면 '안 늘어난다' 로 읽힙니다. 오늘만 세 번 되풀이한
 *      바로 그 잘못입니다.
 *
 * 실행: node scripts/test-capacity-page.mjs
 * ※ 인터넷도 DB 도 필요 없습니다.
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

const page = readFileSync("app/capacity/page.tsx", "utf8");
const lib = readFileSync("lib/capacity.ts", "utf8");
const nav = readFileSync("components/Nav.tsx", "utf8");
const sql = readFileSync("../db/capacity-log.sql", "utf8");
const py = readFileSync("../crawler/capacity.py", "utf8");

console.log("\n[1] 🚨 계산을 화면에 다시 만들지 않는다");
// 재는 일은 capacity.py 한 곳에서만. 여기는 읽어서 보여주기만 합니다.
for (const word of ["FREE_LIMIT", "HORIZON", "steady =", "per_day *", "* 365"]) {
  check(`화면에 '${word}' 같은 계산이 없다`, !page.includes(word),
    "여기에 계산을 만들면 capacity.py 를 고쳐도 화면은 안 바뀝니다");
}
check("읽기 함수에도 계산이 없다",
  !/HORIZON|FREE_LIMIT|steady =/.test(lib));
check("한도도 저장된 값을 그대로 쓴다", /now\.limitMb/.test(page),
  "화면에 500 을 적어 두면 요금제를 바꿨을 때 두 곳이 어긋납니다");
check("capacity.py 가 실제로 저장한다", /def save\(/.test(py) &&
  /capacity_log/.test(py));
check("저장 실패가 수집을 실패로 만들지 않는다",
  /except Exception as exc:[\s\S]{0,400}capacity-log\.sql/.test(py),
  "표가 아직 없는 것은 고장이 아닙니다");

console.log("\n[2] 🚨 999 를 '999일' 이라고 적지 않는다");
check("999 를 따로 다룬다", />= 999/.test(page));
check("'안 참' 처럼 말로 적는다", /안 참/.test(page),
  "999일 남았다고 적으면 거짓말입니다");
check("읽기 함수에도 뜻을 적어 뒀다", /999 = 한도에 닿지 않음/.test(lib));

console.log("\n[3] 🚨 '못 쟀음' 을 0 으로 적지 않는다");
check("못 쟀으면 그렇게 적는다", /못 쟀음/.test(page));
check("null 과 0 을 구분한다", /now\.catalogDay === null/.test(page));
check("저장할 때도 0 대신 빈 값을 넣는다",
  /catalog_measured"\]\s*else None|if p\["catalog_measured"\]\s*\n?\s*else None/.test(py)
  || /else None/.test(py));
check("읽기 함수에 그 뜻이 적혀 있다",
  /아직 못 쟀음. 0 과 다릅니다/.test(lib));

console.log("\n[4] 🚨 관리자만 볼 수 있는가");
check("화면이 역할을 확인한다",
  /currentRole\(\)\) !== "admin"/.test(page));
check("표에 RLS 가 켜져 있다", /ENABLE ROW LEVEL SECURITY/.test(sql));
check("정책이 is_admin() 을 쓴다", /USING \(is_admin\(\)\)/.test(sql),
  "화면만 막으면 공개 열쇠로 직접 부를 때 다 보입니다");
check("회원에게 쓰기를 안 연다",
  !/GRANT (INSERT|UPDATE|DELETE)[^;]*capacity_log[^;]*authenticated/.test(sql) &&
  !/ON capacity_log TO authenticated;[\s\S]{0,10}$/.test(sql));
check("읽기만 열어 준다", /GRANT SELECT ON capacity_log TO authenticated/.test(sql));

console.log("\n[5] 관리자 메뉴에 있는가");
check("메뉴에 [저장 용량] 이 있다", /href: "\/capacity", label: "저장 용량"/.test(nav));
check("관리 묶음에 들어 있다",
  /ADMIN_GROUP[\s\S]{0,220}\/capacity/.test(nav),
  "일반 묶음에 넣으면 방문자 메뉴에 뜹니다");

console.log("\n[6] 아직 준비 안 됐을 때 안내하는가");
check("SQL 을 안 돌렸으면 그렇게 말한다", /capacity-log\.sql/.test(page));
check("표는 있는데 기록이 없을 때도 안내한다", /내일 아침 수집이 끝나면/.test(page));
check("고장으로 보이게 하지 않는다", /needsSql/.test(page) && /needsSql/.test(lib));

console.log("\n[7] 날짜별 뺄셈이 '앞 기록' 과 맞는가");
// 수집이 걸러진 날은 애초에 줄이 없습니다. 표의 아랫줄이 곧 앞 기록입니다.
check("바로 앞 줄과 뺀다", /const prev = rows\[i \+ 1\]/.test(page));
check("앞 기록이 없으면 비운다", /d === null \? "—"/.test(page));
check("늘면 빨강, 줄면 초록",
  /d > 0[\s\S]{0,80}rose[\s\S]{0,80}emerald/.test(page),
  "용량은 느는 것이 나쁜 쪽입니다. 순위와 반대입니다");

console.log("\n[8] 지운 자리가 바로 안 줄어드는 것을 설명하는가");
// 이걸 안 적으면 "정리했는데 왜 그대로지?" 하고 고장으로 오해하십니다.
check("빈 자리 설명이 있다", /빈 자리로 두었다가/.test(page));

console.log();
if (bad) {
  console.log(`❌ ${bad}개 실패`);
  process.exit(1);
}
console.log("✅ 모두 통과");
