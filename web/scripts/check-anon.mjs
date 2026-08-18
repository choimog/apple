/**
 * 공개용 열쇠(anon key)로 자료가 새어 나가지 않는지 확인합니다.
 *
 * 【2026-08-09 확인할 내용이 정반대로 바뀌었습니다】
 * 예전에는 "공개용 열쇠로 **읽을 수 있는지**" 를 확인했습니다.
 * 사이트가 누구에게나 열려 있었기 때문입니다.
 *
 * 이제는 회원 전용입니다. 그래서 확인할 것이 뒤집혔습니다.
 *
 *     예전   공개용 열쇠로 읽혀야 정상
 *     지금   공개용 열쇠로 **안 읽혀야** 정상
 *
 * 【왜 이걸 꼭 확인해야 하나요?】
 * 공개용 열쇠는 브라우저 안에 그대로 들어 있습니다. 감출 수 있는 값이
 * 아닙니다. 사이트(middleware)만 막고 데이터베이스를 안 막으면,
 * 사이트를 거치지 않고 데이터베이스에 직접 물어볼 수 있습니다.
 * 그러면 '회원 전용' 은 잠근 척이 됩니다.
 *
 * 눈으로는 절대 확인할 수 없는 종류의 구멍이라, 기계가 봐야 합니다.
 *
 * ※ SUPABASE_ANON_KEY 가 없으면 확인을 건너뜁니다.
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.log(
    "\nℹ️ 공개용 열쇠 확인을 건너뜁니다.\n" +
      "   GitHub → Settings → Secrets and variables → Actions 에\n" +
      "   SUPABASE_ANON_KEY 를 등록하면 이 확인이 켜집니다.\n" +
      "   (자료가 로그인 없이 새어 나가는지 미리 잡아낼 수 있습니다)"
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

console.log(
  "\n로그인 안 한 사람에게 자료가 보이는지 확인 (안 보여야 정상)\n" + "=".repeat(60)
);

/** 회원에게만 보여야 하는 표 */
const PROTECTED = [
  ["categories", "분야"],
  ["rankings", "일별 순위"],
  ["store_books", "서점별 도서"],
  ["books", "도서 마스터"],
  ["crawl_logs", "수집 기록"],
  // 🚨 2026-08-18 추가. 표 크기는 회원도 볼 이유가 없어서 관리자만
  //    읽도록 막아 두었습니다(db/capacity-log.sql). 로그인 없이는 더더욱.
  ["capacity_log", "용량 기록"],
  // 🚨 2026-08-18 추가. 즐겨찾기는 **회원끼리도** 서로 안 보여야 합니다
  //    (db/favorites.sql). 로그인 없이는 당연히 한 줄도 안 됩니다.
  ["favorites", "즐겨찾기"],
];

let leaking = [];

for (const [table, label] of PROTECTED) {
  const { error, count } = await db
    .from(table)
    .select("*", { count: "exact", head: true });

  if (error) {
    // 보안 규칙에 막히면 오류가 납니다. 이게 정상입니다.
    ok(`${label}(${table})`, "막혀 있습니다");
  } else if (!count) {
    // 규칙이 없으면 오류 없이 0건이 옵니다. 이것도 안 보이는 것입니다.
    ok(`${label}(${table})`, "0건 (안 보임)");
  } else {
    leaking.push(`${label}(${table}) ${count.toLocaleString()}건`);
    bad(
      `🚨 ${label}(${table}) 이(가) 로그인 없이 보입니다`,
      `${count.toLocaleString()}건이 그대로 읽힙니다.`
    );
  }
}

// ---- 쓰기는 여전히 막혀 있어야 합니다 ----
console.log("\n공개용 열쇠로 자료를 바꿀 수 없는지 확인\n" + "=".repeat(60));
{
  const { error, data } = await db
    .from("stores")
    .update({ name: "이 값이 저장되면 안 됩니다" })
    .eq("id", 1)
    .select();

  // ⚠️ 오류가 없어도 안심하면 안 됩니다. 읽기가 막혀 있으면 고칠 줄을
  //    못 찾아서 '0줄 고침' 으로 조용히 끝납니다. 그건 성공이 아닙니다.
  //    실제로 고쳐진 줄이 있는지까지 봐야 합니다.
  if (error) {
    ok("쓰기 차단됨", error.message.slice(0, 80));
  } else if (!data?.length) {
    ok("쓰기 차단됨", "고쳐진 줄이 없습니다");
  } else {
    bad(
      "🚨 공개용 열쇠로 자료를 바꿀 수 있습니다",
      "브라우저에 노출되는 열쇠입니다. 누구나 자료를 지울 수 있는 상태입니다. " +
        "→ Supabase SQL Editor 에서 db/rls.sql 을 즉시 실행하세요."
    );
  }
}

console.log("=".repeat(60));
if (failed) {
  if (leaking.length) {
    console.log(
      "\n🚨 아직 '회원 전용' 이 아닙니다. 자료가 로그인 없이 읽힙니다.\n" +
        `   새는 곳: ${leaking.join(" · ")}\n\n` +
        "   【하실 일 · 2분】\n" +
        "   1. Supabase → Authentication → Users 에서 계정을 먼저 만드세요\n" +
        "      (안 만들고 잠그면 대표님도 못 들어가십니다)\n" +
        "   2. Supabase → SQL Editor → New query 에\n" +
        "      db/auth.sql 전체를 붙여넣고 Run\n\n" +
        "   자세한 설명: docs/login-setup.md"
    );
  }
  process.exit(1);
}
console.log("✅ 로그인 없이는 아무것도 안 보이고, 바꿀 수도 없습니다.");
