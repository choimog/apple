/**
 * 화면 확인용 가짜 데이터베이스 (개발/점검 전용).
 *
 * 【무엇에 쓰나요?】
 * 화면이 실제로 그려지는지 눈으로 보려면 데이터가 필요합니다. 그런데 실제
 * Supabase 열쇠는 GitHub Secrets 에만 있어서 개발 중에는 쓸 수 없습니다.
 * 그래서 Supabase 와 같은 모양으로 응답하는 작은 서버를 띄워, 모든 화면을
 * 한 번씩 열어보고 오류가 나는지 확인합니다.
 *
 * ⚠️ 이건 화면 점검 전용입니다. 배포되는 사이트에는 절대 안 들어갑니다.
 *    여기서 통과했다고 실제 데이터가 맞다는 뜻은 아닙니다.
 *    실제 조회문 확인은 scripts/check-queries.mjs 가 따로 합니다.
 */

import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_DB_PORT || 54321);
const DATES = ["2026-08-08", "2026-08-07", "2026-08-06", "2026-08-05"];

const STORES = [1, 2, 3];
const UNIFIED = ["all", "fiction", "essay", "business", "humanities"];

const categories = [];
let cid = 1;
for (const s of STORES) {
  for (const kind of ["online", "weekly"]) {
    for (const u of UNIFIED) {
      categories.push({
        id: cid++,
        store_id: s,
        name: u === "all" ? "전체" : u,
        kind,
        branch_name: "",
        branch_code: "",
        code: `c${cid}`,
        unified_code: u,
      });
    }
  }
}
for (const b of ["광화문점", "강남점", "부산점"]) {
  categories.push({
    id: cid++,
    store_id: 1,
    name: "전체",
    kind: "offline",
    branch_name: b,
    branch_code: "001",
    code: "00",
    unified_code: "all",
  });
}

const title = (i) => `테스트 도서 ${i}: 아주 긴 제목이 들어갈 수도 있습니다`;
const pubs = ["문학동네", "창비", "민음사", "김영사", "위즈덤하우스"];
const auths = ["김작가", "이작가", "박작가", "최작가", "정작가"];

const combined = (n) =>
  Array.from({ length: n }, (_, i) => ({
    book_id: 1000 + i,
    title: title(i + 1),
    author: auths[i % auths.length],
    publisher: pubs[i % pubs.length],
    cover_url: null,
    store_count: (i % 3) + 1,
    avg_rank: Number((i + 1.4).toFixed(1)),
    ranks: i % 2 ? { 1: i + 1, 2: i + 3 } : { 1: i + 1, 2: i + 2, 3: i + 4 },
    sales: { 2: 900000 - i * 1000, 3: 800000 - i * 900 },
  }));

const nameRank = (n, names) =>
  Array.from({ length: n }, (_, i) => ({
    name: names[i % names.length] + (i >= names.length ? ` ${i}` : ""),
    books: 20 - i,
    best_rank: Number((i + 1.2).toFixed(1)),
    score: 5000 - i * 137,
    top_titles: [title(i + 1), title(i + 2)],
  }));

const rankingRow = (i) => ({
  rank: i + 1,
  sales_point: i % 3 === 0 ? null : 500000 - i * 700,
  store_book_id: 5000 + i,
  category_id: 1,
  snapshot_date: DATES[i % DATES.length],
  store_book: {
    id: 5000 + i,
    store_id: (i % 3) + 1,
    raw_title: title(i + 1),
    raw_author: auths[i % auths.length],
    raw_publisher: pubs[i % pubs.length],
    pub_ym: "2026-07",
    cover_url: null,
    isbn13: i % 2 ? "9791234567890" : null,
    book_id: 1000 + i,
  },
});

const RPC = {
  snapshot_dates: () => DATES.map((d) => ({ snapshot_date: d })),
  category_dates: () => DATES.map((d) => ({ snapshot_date: d })),
  combined_rows: () => combined(50),
  combined_best: (b) => combined(Math.min(b?.p_limit ?? 100, 100)),
  publisher_ranking: (b) => nameRank(Math.min(b?.p_limit ?? 50, 50), pubs),
  author_ranking: (b) => nameRank(Math.min(b?.p_limit ?? 50, 50), auths),
  books_of: () => combined(12),
  search_books_merged: (b) =>
    Array.from({ length: Math.min(b?.p_limit ?? 12, 12) }, (_, i) => ({
      book_id: 1000 + i,
      title: title(i + 1),
      author: auths[i % auths.length],
      publisher: pubs[i % pubs.length],
      pub_ym: "2026-07",
      cover_url: null,
      isbn13: i % 2 ? "9791234567890" : null,
      stores: i % 3 === 0 ? [1, 2, 3] : i % 3 === 1 ? [2] : [1, 3],
      last_seen: DATES[i % DATES.length],
      best_rank: i + 1,
    })),
  crawl_summary: () =>
    DATES.flatMap((d, di) =>
      STORES.map((s) => ({
        snapshot_date: d,
        store_id: s,
        ok_count: 60 - di,
        fail_count: di === 1 && s === 1 ? 2 : 0,
        items: 40000 - di * 300 - s * 100,
        started_at: `${d}T21:0${s}:00.000Z`,
        finished_at: `${d}T22:1${s}:00.000Z`,
      }))
    ),
  category_share: () =>
    ["소설", "에세이", "경제경영", "인문", "자기계발", "어린이"].map((l, i) => ({
      unified_code: `u${i}`,
      label: l,
      books: 30 - i * 4,
    })),
};

const TABLE = {
  categories: () => categories,
  rankings: () => Array.from({ length: 50 }, (_, i) => rankingRow(i)),
  store_books: () => Array.from({ length: 20 }, (_, i) => rankingRow(i).store_book),
  books: () => combined(10),
  crawl_logs: () =>
    Array.from({ length: 12 }, (_, i) => ({
      snapshot_date: DATES[i % DATES.length],
      store_id: (i % 3) + 1,
      category_id: i + 1,
      status: i % 5 === 3 ? "failed" : "success",
      items_collected: i % 5 === 3 ? 0 : 1000 - i,
      items_expected: 1000,
      error_message: i % 5 === 3 ? "ParseError: 시험용 실패 메시지" : null,
      finished_at: `${DATES[i % DATES.length]}T22:1${i % 6}:00.000Z`,
      category: {
        name: UNIFIED[i % UNIFIED.length],
        kind: i % 2 ? "weekly" : "online",
        branch_name: null,
      },
    })),
  archives: () => [],
};

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const parts = url.pathname.replace(/^\/rest\/v1\/?/, "").split("/");
    let out = [];

    if (parts[0] === "rpc" && parts[1]) {
      const fn = RPC[parts[1]];
      out = fn ? fn(body ? JSON.parse(body) : {}) : [];
    } else if (TABLE[parts[0]]) {
      out = TABLE[parts[0]]();
    }

    // head:true + count 요청이면 개수만 알려줍니다
    const wantCount = (req.headers["prefer"] || "").includes("count=");
    res.writeHead(200, {
      "content-type": "application/json",
      "content-range": wantCount ? `0-${out.length - 1}/${out.length}` : "*/*",
      "access-control-allow-origin": "*",
    });
    res.end(req.method === "HEAD" ? "" : JSON.stringify(out));
  });
}).listen(PORT, () => console.log(`가짜 데이터베이스: http://127.0.0.1:${PORT}`));
