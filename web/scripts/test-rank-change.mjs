/**
 * 종합·웰컴 순위 등락 시험 — 2026-08-19 대표님 요청
 *
 *   "종합, 웰컴에도 평균을 낸 수치로 계산된 순위에 등락을 표기해줬으면
 *    좋겠어. 근데 또 그거 만든다고 사이트 가독성이랑 구성 다 엉망으로
 *    만들지는 말고."
 *
 * 【왜 시험이 필요한가요?】
 * 등락은 **틀려도 화면이 멀쩡한** 종류입니다. ▲2 라고 적혀 있으면
 * 그게 맞는지 대표님이 확인하실 방법이 없습니다. 어제 화면을 안 찍어
 * 두셨으니까요. 그래서 사람이 못 보는 것을 기계가 봅니다.
 *
 * 특히 이 두 가지는 **없는 것보다 나쁜** 값이라 따로 못 박습니다.
 *   ① 평균이 같은 책들의 순서가 흔들려서 생기는 **가짜 ▲1 ▼1**
 *   ② 어제 목록이 잘렸을 뿐인데 붙는 **가짜 NEW**
 *
 * 실행: node scripts/test-rank-change.mjs
 * ※ 인터넷도 데이터베이스도 필요 없습니다.
 */

import { readFileSync } from "node:fs";
import { changeNote, rankChanges, sortCombined } from "../lib/rank-change.ts";

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

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
console.log("\n[1] 등락 계산 — 오르면 +, 내리면 −, 제자리는 0");

{
  //      어제:  10  20  30  40
  //      오늘:  30  10  40  20
  const got = rankChanges([30, 10, 40, 20], [10, 20, 30, 40], false);
  check("3위였던 책이 1위로 → ▲2", got[0].change === 2, got[0]);
  check("1위였던 책이 2위로 → ▼1", got[1].change === -1, got[1]);
  check("4위였던 책이 3위로 → ▲1", got[2].change === 1, got[2]);
  check("2위였던 책이 4위로 → ▼2", got[3].change === -2, got[3]);
  check(
    "아무도 'NEW' 가 아니다",
    got.every((g) => g.isNew === false),
    got
  );
}
{
  const got = rankChanges([1, 2, 3], [1, 2, 3], false);
  check(
    "하나도 안 움직이면 전부 0 (null 아님)",
    got.every((g) => g.change === 0),
    got
  );
}

// ---------------------------------------------------------------------------
console.log("\n[2] 🚨 어제 없던 책 — 목록이 잘렸는지에 따라 뜻이 다릅니다");

{
  // 어제 목록을 **끝까지** 봤다 → 없으면 정말 없었던 것
  const got = rankChanges([99, 1], [1, 2, 3], false);
  check("끝까지 본 목록에 없으면 NEW", got[0].isNew === true, got[0]);
  check("NEW 는 계단 수가 없다 (null)", got[0].change === null, got[0]);
}
{
  // 어제 목록이 500줄에서 **잘렸다** → 501위였을 수도 있습니다
  const got = rankChanges([99, 1], [1, 2, 3], true);
  check("잘린 목록에 없으면 NEW 라고 하지 않는다", got[0].isNew === false, got[0]);
  check("대신 '비교 불가'(null) 로 둔다", got[0].change === null, got[0]);
  // 어제 1위였던 책이 오늘은 2위(새 책이 위에 끼어들어서) → ▼1
  check("잘렸어도 있는 책은 그대로 계산한다", got[1].change === -1, got[1]);
}

// ---------------------------------------------------------------------------
console.log("\n[3] 🚨 평균이 같아도 순서가 안 흔들린다 (가짜 ▲1 ▼1 방지)");

{
  // 두 책의 평균도 서점 수도 똑같습니다.
  // 데이터베이스는 이럴 때 순서를 보장하지 않아서, 날마다 뒤바뀔 수 있습니다.
  const A = { bookId: 777, avgRank: 3, storeCount: 3 };
  const B = { bookId: 111, avgRank: 3, storeCount: 3 };

  const day1 = sortCombined([A, B]).map((r) => r.bookId);
  const day2 = sortCombined([B, A]).map((r) => r.bookId); // 오는 차례만 다름
  check("들어온 차례가 달라도 결과는 같다", same(day1, day2), { day1, day2 });

  const got = rankChanges(day2, day1, false);
  check(
    "그래서 자료가 그대로면 등락도 전부 0",
    got.every((g) => g.change === 0),
    got
  );
}
{
  const rows = [
    { bookId: 5, avgRank: 2.5, storeCount: 2 },
    { bookId: 6, avgRank: 2.5, storeCount: 3 }, // 서점 수가 많은 쪽이 위
    { bookId: 7, avgRank: 1.0, storeCount: 1 },
    { bookId: 8, avgRank: null, storeCount: 0 }, // 순위 없는 책은 맨 뒤
  ];
  check(
    "평균 → 서점 수 → 도서 번호 차례로 줄 세운다",
    same(
      sortCombined(rows).map((r) => r.bookId),
      [7, 6, 5, 8]
    ),
    sortCombined(rows).map((r) => r.bookId)
  );
}

// ---------------------------------------------------------------------------
console.log("\n[4] 🚨 비교를 못 한 날은 이유를 화면에 적는다");
// 100줄이 전부 '–' 인데 이유가 없으면 '고장난 화면' 으로 보입니다.
// 낮게 나오는 경고는 안 나오는 경고와 같습니다.

const day = (iso) => `${iso} 라벨`;

check(
  "정상일 때는 견준 날짜를 적는다",
  changeNote({ prevDate: "2026-08-18", blocked: null, truncated: false }, day) ===
    "등락은 2026-08-18 라벨 대비",
  changeNote({ prevDate: "2026-08-18", blocked: null, truncated: false }, day)
);
check(
  "지난 목록이 잘렸으면 그 사실도 적는다",
  /500위까지만/.test(
    changeNote({ prevDate: "2026-08-18", blocked: null, truncated: true }, day)
  )
);
for (const [why, must] of [
  ["no-prev", /이전 수집 기록이 없/],
  ["stores-differ", /서점이 달라/],
  ["slow", /속도 개선/],
]) {
  const msg = changeNote({ prevDate: "2026-08-18", blocked: why, truncated: false }, day);
  check(`'${why}' 이유가 사람 말로 적힌다`, must.test(msg ?? ""), msg);
}
check("등락을 아예 안 켠 화면은 아무 말도 안 한다", changeNote(null, day) === null);

// ---------------------------------------------------------------------------
console.log("\n[5] 🚨 견줄 수 없는 날은 견주지 않는다 (서점 구성이 다른 날)");
/*
  예스24 가 하루 실패하면 그날 평균은 교보·알라딘 둘만의 평균입니다.
  3사 평균과 2사 평균은 **다른 자**입니다. 그걸 견주면 온 목록이
  한꺼번에 오르내린 것처럼 보입니다. 실제로는 아무 일도 없었는데요.
  (3사 기준인 웰컴 화면은 그날 목록이 아예 비어서, 다음 날 전부 NEW 가 됩니다)
*/
const q = readFileSync("lib/queries.ts", "utf8");
check("서점 구성을 날짜별로 비교하는 장치가 있다", /storesOn\(cats, prevDate\)/.test(q), q.includes("storesOn"));
check(
  "다르면 'stores-differ' 로 비교를 멈춘다",
  /none\("stores-differ"/.test(q)
);
check("이전 수집일이 없으면 'no-prev'", /none\("no-prev"/.test(q));
check(
  "지난 목록은 깊게(500줄) 받아온다",
  /p_limit:\s*500/.test(q),
  q.match(/p_limit:[^,\n]*/g)
);
check(
  "느린 길에서는 계산하지 않고 그렇다고 말한다",
  /blocked:\s*"slow"/.test(q)
);

// ---------------------------------------------------------------------------
console.log("\n[6] 두 화면에 실제로 붙어 있나 (종합 · 웰컴)");
// 붙이는 것을 한 군데 빠뜨려도 화면은 멀쩡합니다. 그래서 글자로 확인합니다.

for (const [label, file] of [
  ["종합 (전체 목록)", "app/best/page.tsx"],
  ["웰컴 (TOP 10)", "app/page.tsx"],
]) {
  const src = readFileSync(file, "utf8");
  check(`${label} — 등락을 켰다`, /withChange:\s*true/.test(src));
  check(`${label} — 견준 날짜를 화면에 적는다`, /changeNote\(/.test(src));
}
const row = readFileSync("components/BookRow.tsx", "utf8");
check("종합 줄이 등락을 그린다", /<RankChange/.test(row));
check("웰컴 줄이 등락을 그린다", /<RankChange/.test(readFileSync("app/page.tsx", "utf8")));

// ---------------------------------------------------------------------------
console.log("\n[7] 🚨 등락을 계산하지 않는 화면에는 아무것도 안 그린다");
/*
  출판사 상세·저자 상세·즐겨찾기는 '종합 순위' 가 아니라 다른 목록입니다.
  거기 등수는 뜻이 달라서 등락을 계산하지 않습니다.
  그런데 같은 줄 부품(BookRow)을 쓰기 때문에, 조심하지 않으면
  **'–' 가 100줄** 그려집니다. 그러면 고장난 화면으로 보입니다.

  값이 세 가지인 이유가 이것입니다.
    undefined = 계산 안 함(안 그림) / null = 계산했지만 비교 불가('–') / 숫자
*/
check(
  "BookRow 는 change 가 undefined 면 안 그린다",
  /row\.change !== undefined/.test(row),
  row.match(/row\.change[^\n]*/g)
);
check(
  "웰컴도 같은 규칙",
  /r\.change !== undefined/.test(readFileSync("app/page.tsx", "utf8"))
);
check(
  "출판사·저자 목록은 등락을 채우지 않는다",
  /등락을 채우지 않습니다/.test(q)
);
const fav = readFileSync("lib/favorites.ts", "utf8");
check("즐겨찾기도 채우지 않는다", !/change:/.test(fav), fav.match(/change:[^\n]*/g));

// ---------------------------------------------------------------------------
console.log("\n[8] 화면을 어지럽히지 않는다 (자리·크기)");
/*
  "근데 또 그거 만든다고 사이트 가독성이랑 구성 다 엉망으로 만들지는 말고."

  등락은 **원래 비어 있던 자리**(순위 배지 아래)에 넣었습니다.
  칸을 새로 만들면 휴대폰에서 제목 자리가 그만큼 줄어듭니다.
*/
check(
  "종합: 순위 칸 폭(w-11)을 그대로 둔다",
  /w-11 shrink-0/.test(row),
  row.match(/w-1\d shrink-0/g)
);
check(
  "종합: 등락은 순위 배지 바로 아래",
  /<RankBadge rank=\{position\} \/>\s*\{\/\*[\s\S]*?\*\/\}\s*\{row\.change !== undefined/.test(row)
);
check(
  "좁은 칸이라 작은 크기로 그린다",
  /size="sm"/.test(row) && /size="sm"/.test(readFileSync("app/page.tsx", "utf8"))
);
/*
  🚨 이게 없으면 목록 전체가 두꺼워집니다 (2026-08-19 실측).
     등락을 감싼 칸에 leading-none 이 없으면 그 한 줄이 **24px** 를 먹습니다.
     속의 글자가 10px 라도 줄 상자는 바깥 글자 크기를 따라가기 때문입니다.
     붙이니 16px 가 됐고, 줄 높이 증가가 +15px → +7px 로 줄었습니다.
     지우면 눈에 안 띄게 되돌아갑니다. 그래서 못 박습니다.
*/
for (const [label, file] of [
  ["종합", "components/BookRow.tsx"],
  ["웰컴", "app/page.tsx"],
]) {
  check(
    `${label}: 등락 칸에 leading-none 이 붙어 있다`,
    /mt-0\.5 leading-none/.test(readFileSync(file, "utf8"))
  );
}
const rc = readFileSync("components/RankChange.tsx", "utf8");
check("작게 그려도 색과 화살표는 그대로", /▲/.test(rc) && /▼/.test(rc));
check(
  "'–'(비교 불가) 와 '—'(제자리) 를 구분해 그린다",
  rc.includes("–") && rc.includes("—")
);

// ---------------------------------------------------------------------------
console.log();
if (bad) {
  console.log(`❌ ${bad}개 실패`);
  process.exit(1);
}
console.log("✅ 모두 통과");
