#!/usr/bin/env bash
#
# db/share-check.sql — '왜 공유 링크가 안 되나' 를 알아보는 진단 파일 시험.
#
# 【왜 이 시험이 필요한가요? — 2026-08-10】
# 진단 파일이 **진단하려던 것 때문에 죽었습니다.**
#
#   ERROR: 42883: function share_limits() does not exist
#
# share_limits() 가 없는 것을 알아내려고 만든 파일인데, 그 함수를
# 부르는 문장이 들어 있어서 PostgreSQL 이 문장을 읽는 단계에서 멈췄습니다.
# (CASE 로 감싸도 소용없습니다 — 실행 전에 이름부터 확인하기 때문입니다)
#
# 그래서 **아직 아무것도 안 넣은 상태**에서도 죽지 않고 답을 내놓는지
# 실제 PostgreSQL 로 확인합니다.
#
# 실행: bash tests/test_share_check.sh
# (PostgreSQL 이 없으면 조용히 건너뜁니다)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN=""; for d in /usr/lib/postgresql/*/bin; do [ -x "$d/initdb" ] && PGBIN="$d"; done
[ -z "$PGBIN" ] && { echo "ℹ️ PostgreSQL 없음 — 건너뜀"; exit 0; }
export PATH="$PGBIN:$PATH"
RUN=""; [ "$(id -u)" = "0" ] && { id postgres >/dev/null 2>&1 || exit 0; RUN=1; }
DATA=$(mktemp -d /var/tmp/checktest.XXXXXX); SOCK=/var/tmp
PORT=$(( 18432 + (RANDOM % 2000) )); chmod 777 "$DATA"; [ -n "$RUN" ] && chown postgres "$DATA"
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
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL
cp "$ROOT/db/"{schema,rls,auth,share,share-open,share-check}.sql "$DATA/"
chmod 644 "$DATA"/*.sql
q() { run "psql -h $SOCK -p $PORT -U postgres -q -f $DATA/$1" 2>&1; }
q fake.sql >/dev/null; q schema.sql >/dev/null; q rls.sql >/dev/null
q auth.sql >/dev/null; q share.sql >/dev/null
echo "=== [가] share-open.sql 을 아직 안 넣은 상태 (대표님 지금 상황) ==="
OUT=$(q share-check.sql)
echo "$OUT" | grep -v "^$"
echo "$OUT" | grep -qi "ERROR" && { echo "❌ 진단 파일이 죽었습니다"; exit 1; }
echo "$OUT" | grep -q "❌" || { echo "❌ 문제를 못 찾아냈습니다"; exit 1; }
echo "  ✅ 죽지 않고 '❌ 안 들어갔습니다' 를 알려줍니다"
echo
echo "=== [나] share-open.sql 을 넣은 뒤 ==="
q share-open.sql >/dev/null
OUT2=$(q share-check.sql)
echo "$OUT2" | grep -v "^$"
echo "$OUT2" | grep -qi "ERROR" && { echo "❌ 진단 파일이 죽었습니다"; exit 1; }
echo "$OUT2" | grep -q "❌ 없음" && { echo "❌ 넣었는데도 없다고 합니다"; exit 1; }
echo "  ✅ 전부 정상으로 나옵니다"
