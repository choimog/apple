#!/usr/bin/env bash
#
# db/size-check.sql — '용량이 어디로 가나' 를 재는 진단 파일 시험.
#
# 【왜 이 시험이 필요한가요? — 2026-08-10】
# 바로 전에 만든 진단 파일(db/share-check.sql)이 **진단하려던 것 때문에
# 죽었습니다.** 없는 함수를 부르는 문장이 들어 있어서, PostgreSQL 이
# 문장을 읽는 단계에서 멈춰 버렸습니다.
#
# 대표님께 "이거 실행해 보세요" 하고 드리는 파일이 실행하자마자 죽으면
# 아무것도 알아낼 수 없고 시간만 씁니다. 그래서 드리기 전에 진짜
# PostgreSQL 로 돌려 봅니다. 자료가 하나도 없을 때(0으로 나누기)도
# 죽지 않아야 합니다.
#
# 실행: bash tests/test_size_check.sh
# (PostgreSQL 이 없으면 조용히 건너뜁니다)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN=""; for d in /usr/lib/postgresql/*/bin; do [ -x "$d/initdb" ] && PGBIN="$d"; done
[ -z "$PGBIN" ] && { echo "ℹ️ PostgreSQL 없음 — 건너뜀"; exit 0; }
export PATH="$PGBIN:$PATH"
RUN=""; [ "$(id -u)" = "0" ] && { id postgres >/dev/null 2>&1 || exit 0; RUN=1; }
DATA=$(mktemp -d /var/tmp/sizetest.XXXXXX); SOCK=/var/tmp
PORT=$(( 20432 + (RANDOM % 2000) )); chmod 777 "$DATA"; [ -n "$RUN" ] && chown postgres "$DATA"
run() { if [ -n "$RUN" ]; then su postgres -c "PATH=$PGBIN:\$PATH $1"; else bash -c "$1"; fi; }
trap 'run "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1; rm -rf "$DATA"' EXIT
run "initdb -D $DATA -U postgres --auth=trust" >/dev/null 2>&1 || exit 0
run "pg_ctl -D $DATA -o '-k $SOCK -p $PORT -h \"\"' -l $DATA/log start" >/dev/null 2>&1
sleep 1
cat > "$DATA/fake.sql" <<'SQL'
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL
cp "$ROOT/db/schema.sql" "$ROOT/db/size-check.sql" "$ROOT/db/price-add.sql" "$DATA/"
chmod 644 "$DATA"/*.sql
q() { run "psql -h $SOCK -p $PORT -U postgres -q -f $DATA/$1" 2>&1; }
q fake.sql >/dev/null; q schema.sql >/dev/null
bad=0

bad=0
say() { if [ "$1" = 1 ]; then echo "  ✅ $2"; else echo "  ❌ $2"; bad=1; fi; }

echo "=== [0] db/price-add.sql 이 안전하게 도는가 (2026-08-11) ==="
# 수집이 이 칸을 쓰기 때문에, 이 파일이 실패하면 내일 새벽 수집이 통째로
# 실패합니다. 두 번 실행해도 안전해야 합니다.
P1=$(q price-add.sql)
echo "$P1" | grep -qi "ERROR" && { echo "$P1" | grep -i error; echo "  ❌ 실패"; bad=1; } \
  || echo "  ✅ 오류 없이 돈다"
echo "$P1" | grep -c "✅ 생겼습니다" | grep -q "^2$" && echo "  ✅ 칸 두 개가 생겼다" \
  || { echo "  ❌ 칸이 안 생겼다"; bad=1; }
P2=$(q price-add.sql)
echo "$P2" | grep -qi "ERROR" && { echo "  ❌ 두 번째 실행에서 실패"; bad=1; } \
  || echo "  ✅ 두 번 실행해도 안전하다"

echo
echo "=== [가] 자료가 하나도 없을 때 (0으로 나누기) ==="
OUT=$(q size-check.sql)
echo "$OUT" | grep -qi "ERROR" && { echo "$OUT" | grep -i error; say 0 "죽지 않는다"; } \
  || say 1 "죽지 않는다"
echo "$OUT" | grep -q "division by zero" && say 0 "0으로 안 나눈다" || say 1 "0으로 안 나눈다"

echo
echo "=== [나] 자료를 조금 넣었을 때 ==="
cat > "$DATA/seed.sql" <<'SQL'
-- db/size-check.sql 은 **아직 meta-slim 을 안 돌린** 데이터베이스를 보는
-- 도구입니다. 그래서 시험도 옛 모양(책×날짜)으로 되돌려 놓고 봅니다.
ALTER TABLE book_meta DROP CONSTRAINT book_meta_pkey;
ALTER TABLE book_meta ADD PRIMARY KEY (store_book_id, snapshot_date);
INSERT INTO categories(id, store_id, code, name, kind, url_template)
  VALUES (1, 1, 'c1', '종합', 'online', 'http://x/{page}');
INSERT INTO store_books(id, store_id, store_book_key, raw_title)
  VALUES (1,1,'k1','가'),(2,1,'k2','나');
INSERT INTO rankings(snapshot_date, category_id, rank, store_book_id) VALUES
  ('2026-08-08',1,1,1), ('2026-08-09',1,1,1), ('2026-08-09',1,2,2);
-- 1번 책: 이틀 내내 같은 해시태그 (= 낭비 1줄)
-- 2번 책: 한 줄뿐 (= 꼭 필요한 첫 줄), 게다가 비어 있음
INSERT INTO book_meta(store_book_id, snapshot_date, hashtags, events) VALUES
  (1,'2026-08-08','{소설}','{}'), (1,'2026-08-09','{소설}','{}'),
  (2,'2026-08-09','{}','{}');
SQL
chmod 644 "$DATA/seed.sql"; q seed.sql | grep -i error && { echo "❌ 시험 자료 넣기 실패"; exit 1; }
OUT2=$(q size-check.sql)
echo "$OUT2"
echo "$OUT2" | grep -qi "ERROR" && say 0 "죽지 않는다" || say 1 "죽지 않는다"
# 어제와 똑같은 줄 1개, 빈 줄 1개, 첫 줄 2개가 나와야 맞습니다
echo "$OUT2" | tail -6 | grep -qE '\|[[:space:]]*1[[:space:]]*\|' \
  && say 1 "낭비되는 줄을 세어낸다" || say 0 "낭비되는 줄을 세어낸다"
echo "$OUT2" | grep -q "book_meta" && say 1 "book_meta 를 따로 보여준다" \
  || say 0 "book_meta 를 따로 보여준다"

echo
[ "$bad" = 0 ] && echo "✅ 모두 통과" || { echo "❌ 실패"; exit 1; }
