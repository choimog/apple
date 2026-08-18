/**
 * 🚨 검토 화면이 '자동으로 묶음' 이라고 거짓말하지 않는지 봅니다.
 *
 * 【2026-08-18 대표님 신고】
 *   "실제로는 안 묶여있는데, 왜 매칭도서 페이지에는 자동으로 묶은 것으로
 *    나오지?"
 *
 * 이 화면은 book_matches 에 적힌 **판정**('auto_high')을 읽습니다.
 * 그런데 실제로 묶였는지는 **다른 값**입니다 — store_books.book_id 가
 * 같은지로만 알 수 있습니다. 둘은 어긋날 수 있습니다.
 *
 *   · 저장이 '덮어쓰기' 뿐이라 어제 묶였던 짝의 기록이 그대로 남습니다
 *   · 무리를 정리하면서(출판사·권 번호·같은 서점) 갈라져도 판정은 그대로입니다
 *
 * 원인은 매칭 쪽에서 고쳤습니다(옛 기록 지우기 + 갈라진 짝 제외).
 * 그래도 여기서 한 번 더 봅니다. **판정을 그대로 믿는 화면은 언제든
 * 다시 조용히 거짓말을 합니다.** 화면은 멀쩡해 보입니다.
 *
 * 실행: node scripts/test-review-linked.mjs
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

const lib = readFileSync("lib/review.ts", "utf8");
const page = readFileSync("app/review/page.tsx", "utf8");

console.log("\n[1] 실제 소속(book_id)으로 판단하는가");
check("짝마다 linked 를 계산한다", /linked:\s*a\.bookId !== null && a\.bookId === b\.bookId/.test(lib),
  "판정(decision)이 아니라 book_id 로 봐야 합니다");
check("양쪽 book_id 를 실제로 읽어 온다",
  /\.select\("id,store_id,[^"]*book_id"\)/.test(lib));
check("ReviewPair 에 linked 가 있다", /\blinked:\s*boolean/.test(lib));

console.log("\n[2] 어긋나면 화면에 보이는가");
check("카드가 linked 를 본다", /!pair\.linked/.test(page));
check("'지금은 안 묶임' 이라고 적는다", /지금은 안 묶임/.test(page));
check("경고 색을 쓴다 (조용히 넘어가지 않음)",
  /!pair\.linked[\s\S]{0,400}amber/.test(page));

console.log("\n[3] 🚨 사람이 '다른 책' 이라고 한 짝에는 안 뜨는가");
// manual_split 은 갈라져 있는 것이 정상입니다. 여기에 경고를 띄우면
// [내가 내린 결정] 탭이 통째로 노란 경고밭이 됩니다 → 아무도 안 봅니다.
check("manual_split 은 빼 둔다",
  /!pair\.linked && pair\.decision !== "manual_split"/.test(page));

console.log("\n[4] 🚨 매칭 쪽에서도 거짓 기록을 안 만드는가");
const py = readFileSync("../crawler/run_match.py", "utf8");
const dbpy = readFileSync("../crawler/common/db.py", "utf8");
check("무리에서 갈라진 짝은 저장하지 않는다",
  /oa is not None and oa == ob/.test(py),
  "판정만 적어 두면 화면이 그걸 믿습니다");
check("이제 안 묶이는 옛 기록을 지운다",
  /fetch_auto_match_pairs/.test(py) && /delete_matches/.test(py));
check("사람이 내린 결정은 읽지도 않는다",
  /in_\("decision", \["auto_high", "auto_low"\]\)/.test(dbpy),
  "사람 결정을 지우면 되돌릴 수 없습니다");
check("지우기가 실패해도 매칭은 성공으로 끝난다",
  /except Exception as exc:[\s\S]{0,300}옛 기록 정리에 실패/.test(py));

console.log();
if (bad) {
  console.log(`❌ ${bad}개 실패`);
  process.exit(1);
}
console.log("✅ 모두 통과");
