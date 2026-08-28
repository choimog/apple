#!/usr/bin/env bash
#
# 🚨 [도서 목록 정리] 계산이 (가) 예전과 똑같이 고르고 (나) 빨라졌는지,
#    진짜 PostgreSQL 에 20만 줄을 넣어 확인합니다.
#
# 【2026-08-27 실제로 죽었습니다】
#   postgrest APIError {'code': '57014',
#                       'message': 'canceling statement due to statement timeout'}
#
#   악순환이었습니다. 정리가 안 됨 → 도서 목록이 커짐 → 이 계산이 느려짐
#   → 또 시간 초과 → 더 커짐. 스스로는 못 빠져나옵니다.
#
# 【이 시험이 꼭 필요한 이유】
# 이건 **지우는 계산**입니다. 빠르게 만들었는데 고르는 것이 하나라도
# 달라지면, 지우면 안 될 자료를 지웁니다. 되돌릴 수 없습니다.
# 그래서 "빨라졌다" 보다 **"결과가 완전히 같다"** 를 먼저 봅니다.
#
#   ① 옛 방식과 새 방식이 **똑같은 줄**을 고르는가  ← 이게 제일 중요
#   ② 새 방식이 실제로 빠른가                       ← 그다음
#
# 실행: bash tests/test_prune_speed.sh
# (PostgreSQL 이 깔려 있어야 합니다. 없으면 조용히 건너뜁니다)

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 몇 줄로 시험할지. 실제 운영값(약 20만)과 같은 크기로 잽니다.
ROWS="${PRUNE_TEST_ROWS:-200000}"

PGBIN=""
for d in /usr/lib/postgresql/*/bin; do [ -x "$d/initdb" ] && PGBIN="$d"; done
if [ -z "$PGBIN" ]; then
  echo "ℹ️ PostgreSQL 이 없어 건너뜁니다."
  exit 0
fi
export PATH="$PGBIN:$PATH"

RUN=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || { echo "ℹ️ postgres 계정이 없어 건너뜁니다."; exit 0; }
  RUN="su postgres -c"
fi

DATA=$(mktemp -d /var/tmp/prunetest.XXXXXX)
SOCK=/var/tmp
PORT=$(( 15432 + (RANDOM % 2000) ))
chmod 777 "$DATA"
[ -n "$RUN" ] && chown postgres "$DATA"

run() { if [ -n "$RUN" ]; then su postgres -c "PATH=$PGBIN:\$PATH $1"; else bash -c "$1"; fi; }
cleanup() { run "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1; rm -rf "$DATA"; }
trap cleanup EXIT

run "initdb -D $DATA -U postgres --auth=trust" >/dev/null 2>&1 || {
  echo "ℹ️ 시험용 데이터베이스를 만들지 못해 건너뜁니다."; exit 0; }
run "pg_ctl -D $DATA -o '-k $SOCK -p $PORT -h \"\"' -l $DATA/log start" >/dev/null 2>&1
sleep 1
run "psql -h $SOCK -p $PORT -U postgres -tAc 'select 1'" >/dev/null 2>&1 || {
  echo "ℹ️ 시험용 데이터베이스가 뜨지 않아 건너뜁니다."; exit 0; }

ask() { run "psql -h $SOCK -p $PORT -U postgres -tAc \"$1\"" 2>&1 | tail -1 | tr -d '[:space:]'; }
psqlq() { run "psql -h $SOCK -p $PORT -U postgres -q -f $1" 2>&1; }

FAILED=0
check() {
  if [ "$2" = "$3" ]; then echo "  ✅ $1"
  else echo "  ❌ $1"; echo "       기대: $2   실제: $3"; FAILED=$((FAILED + 1)); fi
}

echo "=================================================================="
echo "  [도서 목록 정리] 계산 — 결과가 같은가 · 빨라졌는가"
echo "  ($ROWS 줄로 시험합니다)"
echo "=================================================================="

# ---- 표를 만듭니다 (실제 schema.sql 중 이 계산에 쓰이는 부분만) ----
cat > "$DATA/mini.sql" <<'SQL'
CREATE TABLE books (id bigserial PRIMARY KEY, title text);
CREATE TABLE store_books (
    id bigserial PRIMARY KEY,
    store_id smallint NOT NULL,
    book_id bigint REFERENCES books(id) ON DELETE SET NULL,
    last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE rankings (
    id bigserial PRIMARY KEY,
    snapshot_date date NOT NULL,
    store_book_id bigint NOT NULL REFERENCES store_books(id) ON DELETE CASCADE
);
CREATE TABLE book_matches (
    id bigserial PRIMARY KEY,
    store_book_a bigint REFERENCES store_books(id) ON DELETE CASCADE,
    store_book_b bigint REFERENCES store_books(id) ON DELETE CASCADE,
    decision text
);
-- 실제 운영과 같은 색인 (db/schema.sql)
CREATE INDEX idx_store_books_book ON store_books(book_id);
CREATE INDEX idx_rankings_book ON rankings(store_book_id, snapshot_date DESC);
CREATE INDEX idx_matches_manual ON book_matches(store_book_a, store_book_b);
SQL
chmod 644 "$DATA/mini.sql"
psqlq "$DATA/mini.sql" | grep -i error && { echo "❌ 표 만들기 실패"; exit 1; }

# ---- 실제와 비슷한 모양으로 자료를 넣습니다 ----
#  · 3분의 1은 최근에 보임(살아 있음), 3분의 2는 오래됨
#  · 일부는 순위가 남아 있음 / 일부는 대표님 결정이 걸림
#  · 3사 묶음을 흉내 내어 book_id 를 공유시킵니다
cat > "$DATA/fill.sql" <<SQL
INSERT INTO books(id, title)
SELECT g, 'book ' || g FROM generate_series(1, $ROWS / 3) g;
SELECT setval('books_id_seq', $ROWS / 3);

INSERT INTO store_books(store_id, book_id, last_seen_at)
SELECT (g % 3) + 1,
       CASE WHEN g % 7 = 0 THEN NULL ELSE (g % ($ROWS / 3)) + 1 END,
       CASE WHEN g % 3 = 0 THEN now() - interval '1 day'
            ELSE now() - interval '40 days' END
  FROM generate_series(1, $ROWS) g;

-- 20분의 1에는 순위가 남아 있습니다 (절대 못 지우는 것들)
INSERT INTO rankings(snapshot_date, store_book_id)
SELECT current_date, id FROM store_books WHERE id % 20 = 0;

-- 1000분의 1에는 대표님 결정이 걸려 있습니다
INSERT INTO book_matches(store_book_a, store_book_b, decision)
SELECT id, id + 1, 'manual_merge' FROM store_books
 WHERE id % 1000 = 0 AND id + 1 <= $ROWS;

ANALYZE;
SQL
chmod 644 "$DATA/fill.sql"
echo ""
echo "자료 넣는 중... ($ROWS 줄)"
psqlq "$DATA/fill.sql" | grep -i "error" && { echo "❌ 자료 넣기 실패"; exit 1; }
echo "  상품 $(ask 'SELECT count(*) FROM store_books;')줄 · \
순위 $(ask 'SELECT count(*) FROM rankings;')줄 · \
결정 $(ask 'SELECT count(*) FROM book_matches;')줄"

# ---- 옛 방식을 '_old' 라는 이름으로 그대로 만듭니다 ----
cat > "$DATA/old.sql" <<'SQL'
CREATE OR REPLACE FUNCTION public.dormant_store_books_old(
    p_days int DEFAULT 14, p_limit int DEFAULT 200000)
RETURNS TABLE (id bigint, book_id bigint)
LANGUAGE sql STABLE AS $$
    WITH alive AS MATERIALIZED (
        SELECT sb.id, sb.book_id FROM store_books sb
         WHERE sb.last_seen_at >= now() - make_interval(days => greatest(p_days, 1))
            OR EXISTS (SELECT 1 FROM rankings r WHERE r.store_book_id = sb.id)
            OR EXISTS (SELECT 1 FROM book_matches m
                        WHERE m.decision IN ('manual_merge', 'manual_split')
                          AND (m.store_book_a = sb.id OR m.store_book_b = sb.id))
    ),
    alive_books AS MATERIALIZED (
        SELECT DISTINCT a.book_id FROM alive a WHERE a.book_id IS NOT NULL
    )
    SELECT sb.id, sb.book_id FROM store_books sb
     WHERE NOT EXISTS (SELECT 1 FROM alive a WHERE a.id = sb.id)
       AND NOT EXISTS (SELECT 1 FROM alive_books ab WHERE ab.book_id = sb.book_id)
     ORDER BY sb.id LIMIT greatest(p_limit, 1);
$$;
SQL
chmod 644 "$DATA/old.sql"
psqlq "$DATA/old.sql" >/dev/null

# ---- 새 방식은 실제 파일에서 그대로 가져옵니다 ----
#  ⚠️ 시험이 계산을 베껴 적으면 안 됩니다. 둘이 어긋나면 시험이 거짓말을
#     하게 됩니다. 그래서 db/prune-catalog.sql 을 그대로 실행합니다.
cp "$ROOT/db/prune-catalog.sql" "$DATA/new.sql"
chmod 644 "$DATA/new.sql"
psqlq "$DATA/new.sql" > "$DATA/newout.txt" 2>&1
if grep -qi "^ERROR" "$DATA/newout.txt"; then
  echo "❌ db/prune-catalog.sql 실행 실패"; grep -i "^ERROR" "$DATA/newout.txt" | head -3; exit 1
fi

echo ""
echo "[1] 🚨 옛 방식과 새 방식이 **똑같은 줄**을 고르는가 (제일 중요)"

check "새 방식에만 있는 줄" "0" \
  "$(ask 'SELECT count(*) FROM (SELECT * FROM dormant_store_books(14, 2000000)
          EXCEPT SELECT * FROM dormant_store_books_old(14, 2000000)) x;')"
check "옛 방식에만 있는 줄" "0" \
  "$(ask 'SELECT count(*) FROM (SELECT * FROM dormant_store_books_old(14, 2000000)
          EXCEPT SELECT * FROM dormant_store_books(14, 2000000)) x;')"

N_NEW=$(ask 'SELECT count(*) FROM dormant_store_books(14, 2000000);')
check "고른 줄 수가 같다" "$N_NEW" \
  "$(ask 'SELECT count(*) FROM dormant_store_books_old(14, 2000000);')"
echo "     (지울 대상으로 고른 줄: ${N_NEW}개)"

# 아무것도 안 고르면 위 비교는 '둘 다 0' 이라 저절로 통과합니다.
# 그러면 시험이 아무것도 안 본 것입니다.
check "🚨 실제로 뭔가를 고르긴 했다 (시험이 헛돌지 않았는지)" "yes" \
  "$(if [ "$N_NEW" -gt 1000 ]; then echo yes; else echo "no($N_NEW)"; fi)"

echo ""
echo "[2] 🚨 지우면 안 되는 것을 고르지 않았는가"

check "순위가 남은 상품은 하나도 안 골랐다" "0" \
  "$(ask 'SELECT count(*) FROM dormant_store_books(14, 2000000) d
           WHERE EXISTS (SELECT 1 FROM rankings r WHERE r.store_book_id = d.id);')"
check "대표님 결정이 걸린 상품도 안 골랐다" "0" \
  "$(ask "SELECT count(*) FROM dormant_store_books(14, 2000000) d
           WHERE EXISTS (SELECT 1 FROM book_matches m
                          WHERE m.decision IN ('manual_merge','manual_split')
                            AND (m.store_book_a = d.id OR m.store_book_b = d.id));")"
check "최근에 보인 상품도 안 골랐다" "0" \
  "$(ask "SELECT count(*) FROM dormant_store_books(14, 2000000) d
            JOIN store_books sb ON sb.id = d.id
           WHERE sb.last_seen_at >= now() - interval '14 days';")"
check "🚨 한 서점이라도 살아 있는 묶음은 통째로 남겼다" "0" \
  "$(ask "SELECT count(*) FROM dormant_store_books(14, 2000000) d
           WHERE d.book_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM store_books s2
                          WHERE s2.book_id = d.book_id
                            AND s2.last_seen_at >= now() - interval '14 days');")"

echo ""
echo "[3] 빨라졌는가 (같은 자료·같은 컴퓨터에서)"

# ⚠️ psql 의 `\timing` 은 -c 와 같이 못 씁니다 (처음에 그렇게 썼다가
#    시간이 빈 값으로 나왔습니다). 바깥에서 시계를 재는 편이 확실합니다.
timeit() {  # timeit <SQL>  → 밀리초
  local t0 t1
  t0=$(date +%s%N)
  run "psql -h $SOCK -p $PORT -U postgres -tAc \"$1\"" >/dev/null 2>&1
  t1=$(date +%s%N)
  echo $(( (t1 - t0) / 1000000 ))
}
T_OLD=$(timeit 'SELECT count(*) FROM dormant_store_books_old(14, 2000000);')
T_NEW=$(timeit 'SELECT count(*) FROM dormant_store_books(14, 2000000);')
T_SUM=$(timeit 'SELECT count(*) FROM dormant_summary(14);')

echo "     옛 방식        ${T_OLD:-?} ms"
echo "     새 방식        ${T_NEW:-?} ms"
echo "     세어 보기 전체 ${T_SUM:-?} ms   ← 실제로 죽었던 단계"

# Supabase 무료 요금제의 한 문장 제한 시간이 8초입니다.
# 거기에 걸려 8/27 에 죽었습니다. 넉넉히 그 절반 안에 들어와야 합니다.
LIMIT_MS=4000
check "새 방식이 ${LIMIT_MS}ms 안에 끝난다" "yes" \
  "$(if [ "${T_NEW:-99999}" -lt "$LIMIT_MS" ]; then echo yes; else echo "no(${T_NEW}ms)"; fi)"
check "세어 보기도 ${LIMIT_MS}ms 안에 끝난다" "yes" \
  "$(if [ "${T_SUM:-99999}" -lt "$LIMIT_MS" ]; then echo yes; else echo "no(${T_SUM}ms)"; fi)"
if [ -n "${T_OLD:-}" ] && [ -n "${T_NEW:-}" ] && [ "${T_NEW}" -gt 0 ]; then
  echo "     → 약 $(( T_OLD / (T_NEW > 0 ? T_NEW : 1) ))배 빨라졌습니다"
fi

echo ""
echo "[4] 색인이 실제로 만들어졌는가"
check "store_books(last_seen_at) 색인이 있다" "1" \
  "$(ask "SELECT count(*) FROM pg_indexes
           WHERE tablename='store_books' AND indexname='idx_store_books_last_seen';")"

echo ""
echo "=================================================================="
if [ "$FAILED" -gt 0 ]; then
  echo "  ❌ ${FAILED}개 실패"
  exit 1
fi
echo "  ✅ 전부 통과"
