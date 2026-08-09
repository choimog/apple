/**
 * 데이터베이스 용량이 언제 찰지 계산합니다.
 *
 * 【왜 따로 떼어 놨나요? — 2026-08-09】
 * 이 계산이 실제로 거짓말을 했습니다. 2일치만 모인 상태에서
 * "하루 95.9MB, 3일 뒤 꽉 참" 이라고 알려 왔는데, 실제와 4배 넘게
 * 차이 납니다. 그 결과 검사가 매번 빨간불이 되어서, 진짜 고장까지
 * 같이 묻힐 뻔했습니다.
 *
 * 틀린 이유는 표의 성격 두 가지를 하나로 뭉뚱그렸기 때문입니다.
 *
 *   · 날마다 쌓이는 것 (rankings, book_meta)
 *     하루치씩 정직하게 늡니다. 보관소로 빠져나갑니다.
 *
 *   · 도서 목록 (books, store_books, book_matches …)
 *     '처음 보는 책' 이 나올 때만 늡니다. 첫날에는 7만 권이 전부
 *     처음이라 폭발하고, 그 뒤로는 거의 안 늘어납니다.
 *     보관소로도 빠지지 않습니다.
 *
 * 첫날의 목록 구축 비용을 '매일 드는 비용' 으로 세면 당연히 과장됩니다.
 *
 * 이제는 계산만 여기에 두고, tests(scripts/test-capacity.mjs)가 검사합니다.
 */

/** 날마다 쌓이고 보관소로 빠져나가는 표. crawler/archive.py 의 TABLES 와 같아야 합니다. */
export const PER_DAY_TABLES = new Set(["rankings", "book_meta"]);

/** 무료 요금제 한도 */
export const FREE_LIMIT_MB = 500;

/** 코드에 박아 둔 최소 보관 일수 (crawler/archive.py 의 ABSOLUTE_MIN_KEEP_DAYS) */
export const MIN_KEEP_DAYS = 14;

const mb = (bytes) => Number(bytes ?? 0) / 1_000_000;

/**
 * @param rows   table_sizes() 결과 [{table_name, total_bytes, data_bytes, index_bytes}]
 * @param nDays  지금 DB 에 들어 있는 수집 날짜 수
 * @param keep   보관 일수 (config/archive.yaml 의 keep_days)
 * @param limit  한도 MB
 */
export function project(rows, nDays, keep, limit = FREE_LIMIT_MB) {
  const safeDays = Math.max(1, Number(nDays) || 1);
  const safeKeep = Math.max(MIN_KEEP_DAYS, Number(keep) || MIN_KEEP_DAYS);

  const total = rows.reduce((a, r) => a + mb(r.total_bytes), 0);
  const dailyMB = rows
    .filter((r) => PER_DAY_TABLES.has(r.table_name))
    .reduce((a, r) => a + mb(r.total_bytes), 0);
  const catalogMB = Math.max(0, total - dailyMB);

  // 하루에 늘어나는 양 — '순위 자료만' 셉니다. 이것만이 정말 날마다 늡니다.
  const perDay = dailyMB / safeDays;

  // 보관 작업이 자리를 잡았을 때 도달할 최대치.
  // 도서 목록은 안 빠지므로 그대로 더합니다.
  const steady = catalogMB + perDay * safeKeep;

  // 보관이 시작되기 전까지는 계속 늡니다. 언제 한도에 닿는지.
  const left = Math.max(0, limit - total);
  const daysLeft = perDay > 0 ? Math.floor(left / perDay) : 999;

  /**
   * 무엇이 문제인지. 없으면 null.
   * ⚠️ 차례가 중요합니다. 구조적인 문제를 먼저 알려야 합니다 —
   *    "며칠 남았다" 만 보면 보관 일수를 줄여야 한다는 걸 모릅니다.
   */
  let problem = null;
  if (steady > limit) {
    problem =
      `보관 ${safeKeep}일을 유지하면 ${steady.toFixed(0)}MB 가 되어 ` +
      `한도(${limit}MB)를 넘습니다. 보관 일수를 줄이거나 저장 항목을 줄여야 합니다.`;
  } else if (daysLeft < 7) {
    problem = `보관이 시작되기 전에 한도에 닿습니다 (약 ${daysLeft}일 뒤).`;
  } else if (total > limit * 0.9) {
    problem = `이미 한도의 90% 를 넘겼습니다.`;
  }

  return { total, dailyMB, catalogMB, perDay, steady, daysLeft, keep: safeKeep, problem };
}

/** 사람이 읽는 한 덩어리 */
export function describe(p, top, limit = FREE_LIMIT_MB) {
  return (
    `${p.total.toFixed(0)}MB / ${limit}MB\n       ` +
    `순위 자료 ${p.dailyMB.toFixed(0)}MB (하루 약 ${p.perDay.toFixed(1)}MB) · ` +
    `도서 목록 ${p.catalogMB.toFixed(0)}MB (거의 안 늘어남)\n       ` +
    `보관 ${p.keep}일 유지 시 예상 최대 ${p.steady.toFixed(0)}MB · ` +
    `이대로 두면 ${p.daysLeft}일 뒤 한도\n       ${top}`
  );
}
