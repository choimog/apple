#!/usr/bin/env bash
#
# db/meta-slim.sql — book_meta 를 '날짜별' 에서 '책마다 한 줄' 로 줄이는 작업 시험.
#
# 【왜 시험이 필요한가요? — 2026-08-10】
# 이 작업은 **줄을 지웁니다. 되돌릴 수 없습니다.**
# 부등호 방향 하나만 반대여도 최신 값이 지워지고 옛것만 남습니다.
# 그러면 화면에는 아무 표시도 안 나고, 대표님은 몇 달 뒤에나 아실 겁니다.
#
# 그래서 진짜 PostgreSQL 에 자료를 넣고 돌려서, **남은 값이 정말
# 최신인지**까지 확인합니다.
#
# 실행: bash tests/test_meta_slim.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN=""; for d in /usr/lib/postgresql/*/bin; do [ -x "$d/initdb" ] && PGBIN="$d"; done
[ -z "$PGBIN" ] && { echo "ℹ️ PostgreSQL 없음 — 건너뜀"; exit 0; }
export PATH="$PGBIN:$PATH"
RUN=""; [ "$(id -u)" = "0" ] && { id postgres >/dev/null 2>&1 || exit 0; RUN=1; }
DATA=$(mktemp -d /var/tmp/metatest.XXXXXX); SOCK=/var/tmp
PORT=$(( 22432 + (RANDOM % 2000) )); chmod 777 "$DATA"; [ -n "$RUN" ] && chown postgres "$DATA"
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
cp "$ROOT/db/schema.sql" "$ROOT/db/meta-slim.sql" "$DATA/"
chmod 644 "$DATA"/*.sql
q() { run "psql -h $SOCK -p $PORT -U postgres -q -f $DATA/$1" 2>&1; }
ask() { run "psql -h $SOCK -p $PORT -U postgres -tAc \"$1\"" 2>&1 | tail -1 | tr -d '[:space:]'; }
q fake.sql >/dev/null

# ---- 지금 운영 중인 모양(날짜별)으로 되돌려 놓고 시작합니다 ----
# schema.sql 은 이미 새 모양이라, 옛 모양을 흉내 내야 진짜 시험이 됩니다.
q schema.sql >/dev/null
cat > "$DATA/old.sql" <<'SQL'
ALTER TABLE book_meta DROP CONSTRAINT book_meta_pkey;
ALTER TABLE book_meta ADD PRIMARY KEY (store_book_id, snapshot_date);
INSERT INTO categories(id, store_id, code, name, kind, url_template)
  VALUES (1, 1, 'c1', '종합', 'online', 'http://x/{page}');
INSERT INTO store_books(id, store_id, store_book_key, raw_title)
  VALUES (1,1,'k1','가'),(2,1,'k2','나'),(3,1,'k3','다');
-- 1번 책: 사흘치. 마지막 날에 해시태그가 바뀜 → '최신' 이 남아야 함
INSERT INTO book_meta(store_book_id, snapshot_date, hashtags, events) VALUES
  (1,'2026-08-07','{옛것}','{}'),
  (1,'2026-08-08','{옛것}','{}'),
  (1,'2026-08-09','{새것}','{이벤트}'),
-- 2번 책: 한 줄뿐
  (2,'2026-08-08','{하나}','{}'),
-- 3번 책: 순서를 일부러 뒤섞어 넣음 (넣은 순서에 기대면 안 됩니다)
  (3,'2026-08-09','{최신}','{}'),
  (3,'2026-08-07','{제일옛것}','{}');
SQL
chmod 644 "$DATA/old.sql"; q old.sql >/dev/null

bad=0
say() { if [ "$1" = 1 ]; then echo "  ✅ $2"; else echo "  ❌ $2 (나온 값: ${3-})"; bad=1; fi; }

echo "[1] 줄이기 전 상태"
say "$([ "$(ask 'SELECT count(*) FROM book_meta')" = 6 ] && echo 1 || echo 0)" "6줄"
say "$([ "$(ask 'SELECT count(DISTINCT store_book_id) FROM book_meta')" = 3 ] && echo 1 || echo 0)" "책 3권"

echo
echo "[2] db/meta-slim.sql 실행"
OUT=$(q meta-slim.sql)
echo "$OUT" | grep -qi "ERROR" && { echo "$OUT" | grep -i error; say 0 "오류 없이 돈다"; } || say 1 "오류 없이 돈다"
echo "$OUT" | grep "✅\|❌" | sed 's/^/     /'

echo
echo "[3] 결과 확인"
say "$([ "$(ask 'SELECT count(*) FROM book_meta')" = 3 ] && echo 1 || echo 0)" \
    "3줄만 남았다" "$(ask 'SELECT count(*) FROM book_meta')"
say "$([ "$(ask 'SELECT count(DISTINCT store_book_id) FROM book_meta')" = 3 ] && echo 1 || echo 0)" \
    "🚨 책은 3권 그대로 (하나도 안 사라짐)"

echo
echo "[4] 🚨 남은 값이 정말 '최신' 인가 (부등호 방향)"
say "$([ "$(ask "SELECT hashtags[1] FROM book_meta WHERE store_book_id=1")" = "새것" ] && echo 1 || echo 0)" \
    "1번 책은 마지막 날 값" "$(ask "SELECT hashtags[1] FROM book_meta WHERE store_book_id=1")"
say "$([ "$(ask "SELECT events[1] FROM book_meta WHERE store_book_id=1")" = "이벤트" ] && echo 1 || echo 0)" \
    "이벤트 문구도 같이 최신"
say "$([ "$(ask "SELECT snapshot_date::text FROM book_meta WHERE store_book_id=1")" = "2026-08-09" ] && echo 1 || echo 0)" \
    "언제 본 값인지도 최신 날짜"
say "$([ "$(ask "SELECT hashtags[1] FROM book_meta WHERE store_book_id=3")" = "최신" ] && echo 1 || echo 0)" \
    "넣은 순서가 뒤섞여도 최신이 남는다" "$(ask "SELECT hashtags[1] FROM book_meta WHERE store_book_id=3")"

echo
echo "[5] 이제 수집기가 덮어쓸 수 있는가 (책 번호 하나가 열쇠)"
INS=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"INSERT INTO book_meta(store_book_id,snapshot_date,hashtags,events) VALUES (1,'2026-08-10','{더새것}','{}') ON CONFLICT (store_book_id) DO UPDATE SET snapshot_date=EXCLUDED.snapshot_date, hashtags=EXCLUDED.hashtags, events=EXCLUDED.events\"" 2>&1)
echo "$INS" | grep -qi error && say 0 "덮어쓰기가 된다" "$INS" || say 1 "덮어쓰기가 된다"
say "$([ "$(ask "SELECT hashtags[1] FROM book_meta WHERE store_book_id=1")" = "더새것" ] && echo 1 || echo 0)" \
    "덮어쓴 값이 들어갔다"
say "$([ "$(ask 'SELECT count(*) FROM book_meta')" = 3 ] && echo 1 || echo 0)" \
    "줄이 안 늘었다 (여전히 3줄)" "$(ask 'SELECT count(*) FROM book_meta')"

echo
echo "[6] 두 번 실행해도 안전한가"
OUT2=$(q meta-slim.sql)
echo "$OUT2" | grep -qi "ERROR" && say 0 "두 번째도 오류 없음" || say 1 "두 번째도 오류 없음"
say "$([ "$(ask 'SELECT count(*) FROM book_meta')" = 3 ] && echo 1 || echo 0)" "결과가 그대로"

echo
[ "$bad" = 0 ] && echo "✅ 모두 통과" || { echo "❌ 실패"; exit 1; }
