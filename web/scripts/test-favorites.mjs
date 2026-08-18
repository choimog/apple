/**
 * 🚨 즐겨찾기 화면이 조용히 틀리지 않는지 봅니다.
 *
 * 【2026-08-18 대표님 요청】
 *   "각 아이디 이용자마다 도서를 즐겨찾기 할 수 있는 기능…
 *    즐겨찾기 목록에 있는 도서가 장기간 업데이트가 안 돼서 지워질 경우,
 *    그 이용자에게 매일 어떤 도서가 지워졌다고 안내문 정도만 남길 수 있나?"
 *
 * 위험한 곳이 넷입니다. 전부 **틀려도 화면은 멀쩡해 보입니다.**
 *
 *   ① 남의 즐겨찾기가 새는 것
 *      화면에서 user_id 로 거르면 조건 하나가 빠졌을 때 티가 안 납니다.
 *      진짜 자물쇠는 데이터베이스에 있어야 합니다.
 *
 *   ② 순위 없는 책이 목록에서 사라지는 것
 *      담아 두신 책이 어느 날 안 보이면 "내가 뺐나?" 가 됩니다.
 *
 *   ③ 순위가 없는데 '0.0위' 라고 적는 것
 *      0.0위는 1위보다 높은 순위입니다. 숫자가 차 있으면 사람은 믿습니다.
 *
 *   ④ 거짓 안내문
 *      [도서 매칭] 이 도서 번호를 새로 매기는 것까지 "지워졌습니다" 로
 *      알리면 매일 뜹니다. 그러면 진짜 안내문을 아무도 안 봅니다.
 *
 * 실행: node scripts/test-favorites.mjs
 * ※ 인터넷도 DB 도 필요 없습니다.
 *   (진짜 데이터베이스로 하는 시험은 tests/test_favorites_sql.sh 입니다)
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

const lib = readFileSync("lib/favorites.ts", "utf8");
const page = readFileSync("app/favorites/page.tsx", "utf8");
const route = readFileSync("app/favorites/action/route.ts", "utf8");
const row = readFileSync("components/BookRow.tsx", "utf8");
const nav = readFileSync("components/Nav.tsx", "utf8");
const btn = readFileSync("components/FavoriteButton.tsx", "utf8");
const sql = readFileSync("../db/favorites.sql", "utf8");
const anon = readFileSync("scripts/check-anon.mjs", "utf8");

console.log("\n[1] 🚨 남의 즐겨찾기는 데이터베이스가 막는가");
check("표에 보안 규칙이 켜져 있다", /ENABLE ROW LEVEL SECURITY/.test(sql));
check("읽기는 내 것만", /FOR SELECT TO authenticated USING \(user_id = auth\.uid\(\)\)/.test(sql));
check("담기도 내 것만", /FOR INSERT TO authenticated WITH CHECK \(user_id = auth\.uid\(\)\)/.test(sql));
check("빼기도 내 것만", /FOR DELETE TO authenticated USING \(user_id = auth\.uid\(\)\)/.test(sql));
check("로그인 안 한 사람에게는 아무 권한도 안 준다",
  /REVOKE ALL ON favorites FROM anon/.test(sql));
check("user_id 는 고칠 수 있는 칸에 없다",
  /GRANT UPDATE \([^)]*\)/.test(sql) && !/GRANT UPDATE \([^)]*user_id/.test(sql),
  "user_id 를 고칠 수 있으면 남의 줄을 내 것으로 바꿀 수 있습니다");
check("새는지 매번 확인한다", /\["favorites", "즐겨찾기"\]/.test(anon));

console.log("\n[2] 🚨 담아 두신 책이 목록에서 소리 없이 사라지지 않는가");
check("순위가 없어도 줄을 돌려준다 (LEFT JOIN)", /LEFT JOIN per_store/.test(sql));
check("책이 지워져도 즐겨찾기 줄은 남는다",
  /REFERENCES books\(id\) ON DELETE SET NULL/.test(sql),
  "CASCADE 로 두면 목록에서 소리 없이 사라집니다");
check("순위 없는 책을 빼지 않고 맨 뒤로 보낸다",
  /avgRank \?\? Infinity/.test(lib));
check("화면이 '사라진 책' 을 따로 보여준다", /사라진 책/.test(page));

console.log("\n[3] 🚨 순위가 없는데 0 이라고 적지 않는가");
check("없으면 null 로 둔다", /avg_rank === null \? null : Number/.test(lib));
check("줄에 '순위 없음' 이라고 적는다",
  /row\.avgRank === null/.test(row) && /순위\s*\n?\s*<br \/>\s*\n?\s*없음/.test(row),
  "0.0위 는 1위보다 높은 순위입니다");
check("서점 수도 0 을 지어내지 않는다", /0 으로 채우지 않습니다/.test(sql));

console.log("\n[4] 🚨 거짓 안내문이 뜨지 않는가 (여기가 가장 중요합니다)");
// [도서 매칭] 은 묶음이 바뀌면 도서 번호를 새로 매깁니다.
// 2026-08-18 실행에서만 552종이 그랬습니다.
check("번호만 바뀐 책은 다시 잇는다", /relink_my_favorites/.test(sql));
check("화면이 목록을 그리기 전에 먼저 잇는다",
  /await relinkFavorites\(\)[\s\S]{0,400}await myFavorites\(\)/.test(page),
  "잇기 전에 세면 멀쩡한 책이 '사라짐' 으로 잡힙니다");
check("이름이 같은 책이 여럿이면 짐작하지 않는다",
  /found\.n = 1/.test(sql));
check("확인하면 안내문이 내려간다", /noticed_at/.test(sql) && /markNoticed/.test(lib));
check("무엇이 사라졌는지 이름으로 알려 준다",
  /title\s+text\s+NOT NULL/.test(sql) && /coalesce\(OLD\.title, title\)/.test(sql),
  "번호만 남기면 무엇이 사라졌는지 알 수 없습니다");

console.log("\n[5] 준비가 안 됐을 때 안내하는가");
check("SQL 을 안 돌렸으면 그렇게 말한다", /db\/favorites\.sql/.test(page));
check("조용히 빈 화면을 띄우지 않는다", /needsSql/.test(page) && /needsSql/.test(lib));
check("별표는 표가 없으면 아예 안 그린다", /faved === null \? null/.test(
  readFileSync("app/book/[id]/page.tsx", "utf8")));

console.log("\n[6] 메뉴와 버튼");
check("메뉴에 [즐겨찾기] 가 있다", /href: "\/favorites", label: "즐겨찾기"/.test(nav));
check("관리자 전용 묶음에 넣지 않았다",
  !/ADMIN_GROUP[\s\S]{0,240}\/favorites/.test(nav),
  "회원 누구나 쓰는 기능입니다");
check("별표가 제목·저자도 함께 보낸다",
  /name="title"/.test(btn) && /name="author"/.test(btn),
  "나중에 그 책이 지워졌을 때 이름으로 알려 드리려면 필요합니다");
check("누른 뒤 원래 화면으로 돌아간다", /name="back"/.test(btn));
check("바깥 주소로 튕겨 보내지 않는다",
  /startsWith\("\/"\) && !rawBack\.startsWith\("\/\/"\)/.test(route));
check("로그인 확인은 한다", /currentRole\(\)\) === null/.test(route));

console.log();
if (bad) {
  console.log(`❌ ${bad}개 실패`);
  process.exit(1);
}
console.log("✅ 모두 통과");
