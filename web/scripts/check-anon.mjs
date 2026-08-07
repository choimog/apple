/**
 * 사이트가 실제로 쓰는 '공개용 열쇠(anon key)' 로 데이터를 읽을 수 있는지 확인합니다.
 *
 * 【왜 필요한가요? — 2026-08-07 실제로 겪은 문제】
 * 조회문 확인을 '관리자 열쇠' 로만 했더니 전부 통과했는데,
 * 정작 배포한 사이트는 "데이터가 없습니다" 로 떴습니다.
 * 관리자 열쇠는 보안 잠금(RLS)을 통과하지만 공개용 열쇠는 안 그렇기 때문입니다.
 *
 * 그래서 사이트와 똑같은 열쇠로 한 번 더 확인합니다.
 *
 * 【추가로 확인하는 것 — 보안】
 * 공개용 열쇠는 브라우저에 노출됩니다. 그 열쇠로 데이터를 지울 수 있으면 큰일입니다.
 * 그래서 "쓰기가 막혀 있는지" 도 함께 확인합니다.
 *
 * ※ SUPABASE_ANON_KEY 가 없으면 확인을 건너뜁니다 (실패로 처리하지 않음).
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.log(
    "\nℹ️ 공개용 열쇠 확인을 건너뜁니다.\n" +
      "   GitHub → Settings → Secrets and variables → Actions 에\n" +
      "   SUPABASE_ANON_KEY 를 등록하면 이 확인이 켜집니다.\n" +
      "   (사이트가 실제로 데이터를 읽을 수 있는지 미리 잡아낼 수 있습니다)"
  );
  process.exit(0);
}

const db = createClient(url, anonKey, { auth: { persistSession: false } });

let failed = 0;
const ok = (m, d = "") => console.log(`  ✅ ${m}${d ? " — " + d : ""}`);
const bad = (m, d) => {
  console.log(`  ❌ ${m}\n       ${d}`);
  failed += 1;
};

console.log("\n사이트와 같은 열쇠(공개용)로 읽기 확인\n" + "=".repeat(60));

// ---- 읽을 수 있어야 하는 표들 ----
for (const [table, label] of [
  ["categories", "분야"],
  ["rankings", "일별 순위"],
  ["store_books", "서점별 도서"],
  ["books", "도서 마스터"],
  ["crawl_logs", "수집 기록"],
]) {
  const { data, error, count } = await db
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) {
    bad(`${label}(${table}) 읽기`, error.message);
  } else if (!count) {
    bad(
      `${label}(${table}) 읽기`,
      "오류는 없는데 0건입니다. 보안 잠금(RLS)에 읽기 허용 규칙이 없을 때 이렇게 됩니다. " +
        "→ Supabase SQL Editor 에서 db/rls.sql 을 실행하세요."
    );
  } else {
    ok(`${label}(${table}) 읽기`, `${count.toLocaleString()}건`);
  }
  void data;
}

// ---- 쓰기는 막혀 있어야 합니다 ----
console.log("\n공개용 열쇠로 데이터를 바꿀 수 없는지 확인\n" + "=".repeat(60));
{
  const { error } = await db
    .from("stores")
    .update({ name: "이 값이 저장되면 안 됩니다" })
    .eq("id", 1)
    .select();

  if (error) {
    ok("쓰기 차단됨", error.message.slice(0, 80));
  } else {
    bad(
      "🚨 공개용 열쇠로 데이터를 바꿀 수 있습니다",
      "브라우저에 노출되는 열쇠입니다. 누구나 데이터를 지울 수 있는 상태입니다. " +
        "→ Supabase SQL Editor 에서 db/rls.sql 을 즉시 실행하세요."
    );
  }
}

console.log("=".repeat(60));
if (failed) {
  console.log(`❌ 문제 ${failed}건 — 위 안내대로 db/rls.sql 을 실행하세요.`);
  process.exit(1);
}
console.log("✅ 사이트는 읽을 수 있고, 함부로 바꿀 수는 없습니다.");
