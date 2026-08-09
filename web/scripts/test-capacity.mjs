/**
 * 용량 예측이 거짓말을 하지 않는지 시험.
 *
 * 【왜 필요한가요? — 2026-08-09】
 * 이 계산이 실제로 틀렸습니다. 2일치만 모인 상태에서
 * "하루 95.9MB · 3일 뒤 꽉 참" 이라고 알려서 검사가 매번 빨간불이
 * 됐습니다. 검사가 늘 빨간불이면 진짜 고장도 같이 묻힙니다.
 *
 * 그래서 그때의 실제 숫자를 그대로 넣어 두고, 다시는 그 답이
 * 나오지 않는지 확인합니다.
 *
 * 실행: node scripts/test-capacity.mjs
 */

import { FREE_LIMIT_MB, project } from "./capacity.mjs";

let failed = 0;

function check(name, ok, got) {
  if (ok) {
    console.log(`  ✅ ${name}`);
  } else {
    console.log(`  ❌ ${name}` + (got !== undefined ? `\n       나온 값: ${got}` : ""));
    failed += 1;
  }
}

const MB = 1_000_000;
const t = (name, total, data, index) => ({
  table_name: name,
  total_bytes: total * MB,
  data_bytes: data * MB,
  index_bytes: index * MB,
});

console.log("=".repeat(60));
console.log("용량 예측");
console.log("=".repeat(60));

/* ------------------------------------------------------------------ */
console.log("\n[1] 2026-08-09 에 실제로 나온 숫자");
// 그때 로그: 192MB / 500MB · 2일치 · 하루 약 95.9MB · 남은 여유 약 3일
//            store_books 55MB · books 53MB · rankings 32MB
//
// ⚠️ 로그에는 큰 표 3개만 찍혔습니다. 나머지 4개는 합이 192MB 가 되도록
//    제가 채운 값입니다. 전체 합·상위 3개는 실제 값이고,
//    book_matches / book_meta / crawl_logs 의 배분은 추정입니다.
const real = [
  t("store_books", 55, 36, 20),
  t("books", 53, 20, 33),
  t("rankings", 32, 14, 18),
  t("book_matches", 30, 18, 12),
  t("book_meta", 12, 8, 4),
  t("crawl_logs", 10, 8, 2),
];
const p = project(real, 2, 14);

check("전체는 그대로 192MB", Math.round(p.total) === 192, p.total.toFixed(1));
check(
  "하루 증가량이 95.9MB 가 아니다 (그게 거짓말이었습니다)",
  p.perDay < 40,
  `${p.perDay.toFixed(1)}MB/일`,
);
check("순위 자료만 센다 (rankings 32 + book_meta 12) ÷ 2일 = 22MB",
  Math.abs(p.perDay - 22) < 0.01, p.perDay.toFixed(2));
check("도서 목록은 따로 센다 (192 - 44 = 148MB)",
  Math.abs(p.catalogMB - 148) < 0.01, p.catalogMB.toFixed(1));
check("'3일 뒤 꽉 참' 이라고 하지 않는다", p.daysLeft > 10, `${p.daysLeft}일`);

/* ------------------------------------------------------------------ */
console.log("\n[2] 도달할 최대치를 본다 — 이게 진짜 봐야 할 숫자");
// 148 + 22×14 = 456MB. 한도 안이지만 여유가 44MB 뿐입니다.
check("예상 최대 = 목록 + 하루치×보관일수", Math.abs(p.steady - 456) < 0.01,
  p.steady.toFixed(1));
check("한도 안이면 문제 없음으로 본다", p.problem === null, p.problem);

/* ------------------------------------------------------------------ */
console.log("\n[3] 구조적으로 안 맞으면 먼저 알린다");
// 보관 일수를 늘리면 넘칩니다. '며칠 남았다' 만 봐서는 이걸 못 봅니다.
const long = project(real, 2, 30);
check("보관 30일이면 넘친다고 알린다", long.problem !== null, long.problem);
check("보관 일수를 줄이라고 말한다",
  (long.problem ?? "").includes("보관 일수"), long.problem);

/* ------------------------------------------------------------------ */
console.log("\n[4] 보관 일수는 14일 밑으로 못 내려간다");
// crawler/archive.py 에 최소값이 박혀 있습니다. 여기서 7일이라고 계산하면
// 실제보다 낙관적인 답이 나옵니다.
const tooShort = project(real, 2, 7);
check("7일을 넣어도 14일로 계산한다", tooShort.keep === 14, tooShort.keep);

/* ------------------------------------------------------------------ */
console.log("\n[5] 진짜 위험할 때는 반드시 알린다");
const huge = [t("rankings", 300, 150, 150), t("books", 160, 100, 60)];
const risky = project(huge, 2, 14);
check("이미 90% 를 넘겼으면 알린다", risky.problem !== null, risky.problem);

const soon = [t("rankings", 40, 20, 20), t("books", 420, 300, 120)];
const p2 = project(soon, 2, 14);   // 하루 20MB, 남은 40MB → 2일
check("곧 닿으면 알린다", p2.problem !== null, p2.problem);

/* ------------------------------------------------------------------ */
console.log("\n[6] 이상한 값이 들어와도 안 터진다");
check("빈 목록", project([], 0, 14).total === 0);
check("날짜 0일을 1일로 본다", project(real, 0, 14).perDay > 0);
check("한도 그 자체", project([t("rankings", FREE_LIMIT_MB, 1, 1)], 1, 14).problem !== null);

console.log("\n" + "=".repeat(60));
if (failed) {
  console.log(`❌ 실패 ${failed}건`);
  process.exit(1);
}
console.log("✅ 용량 예측 전부 통과");
