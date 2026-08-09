/**
 * 화면이 쓰는 조회문이 실제 데이터베이스에서 동작하는지 확인합니다.
 *
 * 【왜 필요한가요?】
 * 화면 코드가 '컴파일 성공' 하는 것과 '실제로 데이터가 나오는 것' 은 다릅니다.
 * 조회문에 오타가 있어도 컴파일은 통과합니다. 그러면 배포한 뒤에야
 * 빈 화면을 보게 됩니다. 그 전에 여기서 잡습니다.
 *
 * ※ 이 파일은 GitHub Actions 안에서만 돌아갑니다.
 *   배포되는 사이트에는 포함되지 않고, 열쇠도 브라우저로 나가지 않습니다.
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

let failed = 0;

function ok(name, detail = "") {
  console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`);
}
function bad(name, err) {
  console.log(`  ❌ ${name}\n       ${err}`);
  failed += 1;
}

async function step(name, fn) {
  try {
    const detail = await fn();
    ok(name, detail);
  } catch (e) {
    bad(name, e?.message ?? String(e));
  }
}

console.log("\n화면이 쓰는 조회문 확인\n" + "=".repeat(60));

// ---- 1. 분야 목록 ----
let firstCategory = null;
await step("분야 목록 (categories)", async () => {
  const { data, error } = await db
    .from("categories")
    .select("id,store_id,name,kind,branch_name,code")
    .eq("enabled", true)
    .order("store_id")
    .order("kind")
    .order("branch_name")
    .order("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("분야가 하나도 없습니다");
  firstCategory = data[0];
  return `${data.length}개 (첫 항목: ${data[0].name})`;
});

// ---- 2. 수집된 날짜 ----
let latestDate = null;
await step("수집된 날짜 (rankings)", async () => {
  const { data, error } = await db
    .from("rankings")
    .select("snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(3000);
  if (error) throw new Error(error.message);
  const dates = [...new Set((data ?? []).map((r) => r.snapshot_date))];
  if (!dates.length) throw new Error("수집된 날짜가 없습니다");
  latestDate = dates[0];
  return `${dates.length}일 (최신: ${latestDate})`;
});

// ---- 3. 순위표 (서점 도서와 이어붙이기) ----
//     ← 여기가 가장 틀리기 쉬운 부분입니다
await step("순위표 + 도서 정보 이어붙이기", async () => {
  if (!firstCategory || !latestDate) throw new Error("앞 단계 실패로 건너뜀");
  const { data, error } = await db
    .from("rankings")
    .select(
      `rank, sales_point,
       store_book:store_books!inner (
         id, store_id, raw_title, raw_author, raw_publisher,
         pub_ym, cover_url, isbn13, book_id
       )`
    )
    .eq("snapshot_date", latestDate)
    .order("rank")
    .limit(5);
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("순위가 하나도 안 나왔습니다");
  const top = data[0];
  if (!top.store_book?.raw_title) {
    throw new Error("도서 제목이 비어 있습니다 (이어붙이기 실패)");
  }
  return `${data.length}건, 1위: ${top.store_book.raw_title}`;
});

// ---- 4. 검색 ----
await step("도서 검색", async () => {
  const { data, error } = await db
    .from("store_books")
    .select("id,raw_title")
    .or("raw_title.ilike.%의%,raw_author.ilike.%의%")
    .limit(5);
  if (error) throw new Error(error.message);
  return `${data?.length ?? 0}건`;
});

// ---- 5. 도서 상세 (같은 책으로 묶인 것) ----
await step("도서 상세 (묶인 책의 3사 이력)", async () => {
  const { data: linked, error: e1 } = await db
    .from("store_books")
    .select("book_id")
    .not("book_id", "is", null)
    .limit(1);
  if (e1) throw new Error(e1.message);
  if (!linked?.length) return "아직 묶인 책이 없습니다 (매칭 실행 전)";

  const bookId = linked[0].book_id;
  const { data: sbs, error: e2 } = await db
    .from("store_books")
    .select("id,store_id,raw_title,cover_url,isbn13")
    .eq("book_id", bookId);
  if (e2) throw new Error(e2.message);

  const ids = (sbs ?? []).map((s) => s.id);
  const { data: hist, error: e3 } = await db
    .from("rankings")
    .select("snapshot_date,rank,sales_point,store_book_id,category_id")
    .in("store_book_id", ids)
    .limit(50);
  if (e3) throw new Error(e3.message);
  return `도서 ${bookId}: ${sbs.length}개 서점, 순위기록 ${hist?.length ?? 0}건`;
});

// ---- 6. 수집 상태 ----
await step("수집 상태 (crawl_logs)", async () => {
  const { data, error } = await db
    .from("crawl_logs")
    .select("snapshot_date,store_id,status,items_collected,error_message")
    .order("id", { ascending: false })
    .limit(5);
  if (error) throw new Error(error.message);
  return `${data?.length ?? 0}건`;
});

// ---- 7. 표지 주소가 실제로 있는지 ----
await step("표지 주소 보유율", async () => {
  const { count: total } = await db
    .from("store_books")
    .select("id", { count: "exact", head: true });
  const { count: withCover } = await db
    .from("store_books")
    .select("id", { count: "exact", head: true })
    .not("cover_url", "is", null);
  if (!total) throw new Error("도서가 없습니다");
  const pct = Math.round(((withCover ?? 0) / total) * 100);
  if (pct < 50) throw new Error(`표지 주소가 ${pct}% 뿐입니다 (너무 낮음)`);
  return `${withCover}/${total} (${pct}%)`;
});

// ---- 8. 분야 목록에 통합 분야 코드가 들어 있는지 ----
//     종합 순위는 이 값으로 3사를 짝지어 묶습니다. 없으면 종합 화면이 빕니다.
let unifiedForCombined = null;
await step("통합 분야 코드 (종합 순위의 짝짓기 기준)", async () => {
  const { data, error } = await db
    .from("categories")
    .select("id,store_id,name,kind,branch_name,branch_code,code,unified_code")
    .eq("enabled", true);
  if (error) throw new Error(error.message);

  const byUnified = new Map();
  for (const c of data ?? []) {
    if (!c.unified_code || c.kind === "offline") continue;
    const k = `${c.unified_code}|${c.kind === "weekly" ? "weekly" : "daily"}`;
    if (!byUnified.has(k)) byUnified.set(k, new Set());
    byUnified.get(k).add(c.store_id);
  }
  const usable = [...byUnified.entries()].filter(([, s]) => s.size >= 2);
  if (!usable.length) {
    throw new Error(
      "2개 이상 서점에 공통으로 있는 분야가 없습니다. " +
        "config/sources.yaml 의 unified 값을 확인하세요."
    );
  }
  unifiedForCombined = usable[0][0].split("|");
  return `${usable.length}개 분야가 2사 이상 공통 (예: ${unifiedForCombined[0]})`;
});

// ---- 9. 종합 순위 조회문 ----
//     열 이름을 두 번 적는 실수를 여기서 잡습니다.
await step("종합 순위 (3사 평균)", async () => {
  if (!latestDate || !unifiedForCombined) throw new Error("앞 단계 실패로 건너뜀");
  const [unified, period] = unifiedForCombined;

  const { data: cats, error: e0 } = await db
    .from("categories")
    .select("id,store_id,kind")
    .eq("enabled", true)
    .eq("unified_code", unified);
  if (e0) throw new Error(e0.message);

  const ids = (cats ?? [])
    .filter(
      (c) =>
        c.kind !== "offline" &&
        (c.kind === "weekly" ? "weekly" : "daily") === period
    )
    .map((c) => c.id);
  if (!ids.length) throw new Error("해당 분야의 목록이 없습니다");

  const { data, error } = await db
    .from("rankings")
    .select(
      `rank, sales_point, category_id,
       store_book:store_books!inner (
         id, store_id, raw_title, raw_author, raw_publisher,
         pub_ym, cover_url, isbn13, book_id
       )`
    )
    .in("category_id", ids)
    .eq("snapshot_date", latestDate)
    .lte("rank", 300)
    .order("rank")
    .limit(1000);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const linked = rows.filter((r) => r.store_book?.book_id);
  const byBook = new Map();
  const catStore = new Map((cats ?? []).map((c) => [c.id, c.store_id]));
  for (const r of linked) {
    const b = r.store_book.book_id;
    if (!byBook.has(b)) byBook.set(b, new Set());
    byBook.get(b).add(catStore.get(r.category_id));
  }
  const multi = [...byBook.values()].filter((s) => s.size >= 2).length;

  if (!rows.length) throw new Error("순위가 하나도 안 나왔습니다");
  if (!linked.length) {
    return `${rows.length}건 (아직 묶인 책이 없어 종합 순위는 비어 있습니다 — 매칭 실행 전)`;
  }
  return `${rows.length}건 중 묶인 것 ${linked.length}건, 2사 이상 등장 ${multi}종`;
});

// ---- 10. 순위 개수 세기 (더보기 버튼 판단용) ----
await step("분야별 권수 세기", async () => {
  if (!firstCategory || !latestDate) throw new Error("앞 단계 실패로 건너뜀");
  const { count, error } = await db
    .from("rankings")
    .select("rank", { count: "exact", head: true })
    .eq("category_id", firstCategory.id)
    .eq("snapshot_date", latestDate);
  if (error) throw new Error(error.message);
  return `${firstCategory.name}: ${count ?? 0}권`;
});

// ---- 11. (없앰) 출판사 섞임 점검 ----
//     여기서 SQL 로 확인했었는데, SQL 은 출판사 이름을 '글자가 똑같은가' 로만
//     비교할 수 있어서 '문학사상 / 문학사상사' 처럼 같은 곳을 다르다고
//     알려 왔습니다. 실제 규칙은 '얼마나 닮았는가' 로 봅니다.
//     같은 판단을 두 군데에 적으면 한쪽은 반드시 거짓말을 하므로,
//     점검은 crawler/verify_publishers.py 한 곳에서만 합니다.
//     (그 파일은 [도서 매칭] 작업이 끝날 때마다 자동으로 돕니다)

// ---- 12. 분야별 날짜 목록 (서점별 화면이 씁니다) ----
//     이게 없으면 "8/8 은 없는데 8/7 은 있다" 같은 혼란이 다시 생깁니다.
await step("분야별 수집 날짜 (category_dates)", async () => {
  if (!firstCategory) throw new Error("앞 단계 실패로 건너뜀");
  const { data, error } = await db.rpc("category_dates", {
    p_category_id: firstCategory.id,
    n: 30,
  });
  if (error) {
    if (/function|does not exist|schema cache/i.test(error.message)) {
      return "건너뜀 — db/perf.sql 을 아직 실행하지 않았습니다";
    }
    throw new Error(error.message);
  }
  return `${firstCategory.name}: ${(data ?? []).length}일`;
});

// ---- 13. 용량 ----
//
// 【2026-08-09 이 확인은 파이썬 쪽으로 옮겼습니다】
// crawler/capacity.py 로 갔고, **매일 수집이 끝난 뒤** 돕니다.
//
// 여기 있을 때는 제가 코드를 고쳐서 올릴 때만 확인했습니다. 제가 손을
// 떼면 아무도 안 보게 됩니다. 용량이 차면 수집이 멈추고 사이트도 멈추는데,
// 그걸 몇 주 뒤에 알게 되는 구조였습니다.
//
// 같은 계산을 두 군데 두면 반드시 어긋나므로 여기서는 지웠습니다.
// 한쪽만 고치게 되니까요.

// ---- 14. 회원 전용 설정이 살아 있는가 ----
//
// 【왜 필요한가요? — 2026-08-09】
// 회원 전용은 Supabase 화면에서 손으로 켜는 부분이 있습니다. 손으로 하는
// 것은 언젠가 빠집니다. 특히 이 둘은 빠져도 아무 표시가 안 납니다.
//
//   · 관리자가 0명   → [매칭 검토] 메뉴가 아무에게도 안 보입니다
//   · 계정이 0개     → 아무도 사이트에 못 들어갑니다
//
// 대표님 브라우저는 로그인이 되어 있으니 늘 정상으로 보입니다.
// 그래서 기계가 봅니다. (이 확인은 관리자 열쇠로 하므로 잠금과 무관합니다)
await step("회원 전용 설정", async () => {
  const { data, error } = await db.from("profiles").select("id,role");
  if (error) {
    if (/profiles|does not exist|schema cache/i.test(error.message)) {
      return "건너뜀 — 아직 회원 전용을 켜지 않았습니다 (docs/login-setup.md)";
    }
    throw new Error(error.message);
  }
  const rows = data ?? [];
  const admins = rows.filter((r) => r.role === "admin").length;

  if (!rows.length) {
    throw new Error(
      "계정이 하나도 없습니다. 이대로 잠그면 아무도 못 들어갑니다.\n" +
        "       Supabase → Authentication → Users → Add user"
    );
  }
  if (!admins) {
    throw new Error(
      "관리자가 0명입니다. [매칭 검토] 화면이 아무에게도 안 보입니다.\n" +
        "       db/auth.sql 의 3번에 적힌 이메일이 실제 계정과 같은지 확인하세요."
    );
  }
  return `회원 ${rows.length}명 (관리자 ${admins}명)`;
});

// ---- 15. 검토 화면이 쓸 준비가 됐는가 ----
await step("매칭 검토 화면 준비", async () => {
  const { error } = await db
    .from("book_matches")
    .select("id,auto_decision")
    .limit(1);
  if (error) {
    if (/auto_decision|column/i.test(error.message)) {
      throw new Error(
        "book_matches 에 auto_decision 칸이 없습니다. '되돌리기' 가 안 됩니다.\n" +
          "       Supabase → SQL Editor 에서 db/auth.sql 을 한 번 더 실행하세요."
      );
    }
    throw new Error(error.message);
  }
  const { count: pending } = await db
    .from("book_matches")
    .select("id", { count: "exact", head: true })
    .eq("decision", "auto_low");
  return `검토 대기 ${(pending ?? 0).toLocaleString()}쌍`;
});

console.log("=".repeat(60));
if (failed) {
  console.log(`❌ 실패 ${failed}건 — 화면이 빈 채로 뜰 수 있습니다.`);
  process.exit(1);
}
console.log("✅ 화면이 쓰는 조회문 전부 정상");
