#!/usr/bin/env bash
#
# 보안 규칙(db/auth.sql)이 실제로 막는지, 진짜 데이터베이스로 시험합니다.
#
# 【왜 필요한가요? — 2026-08-09】
# 보안 규칙은 **틀려도 화면이 멀쩡해 보입니다.** 대표님 브라우저는
# 로그인이 되어 있으니 늘 정상으로 보이고, 잘못 열려 있어도 아무 표시가
# 나지 않습니다. 눈으로는 절대 확인할 수 없는 종류입니다.
#
# 그래서 빈 데이터베이스를 하나 띄워서 실제로 시켜 봅니다.
#   · 로그인 안 한 사람이 순위를 읽을 수 있는가        → 없어야 함
#   · 보기 전용 회원이 판단을 고칠 수 있는가            → 없어야 함
#   · 보기 전용 회원이 스스로 관리자가 될 수 있는가     → 없어야 함
#   · 관리자가 판단을 고칠 수 있는가                    → 있어야 함
#   · 관리자가 점수 같은 다른 칸을 고칠 수 있는가       → 없어야 함
#   · 관리자가 남의 이름으로 결정을 남길 수 있는가      → 없어야 함
#   · 되돌리기(이름 지우기)가 되는가                    → 있어야 함
#
# 실행: bash tests/test_auth_sql.sh
# (PostgreSQL 이 깔려 있어야 합니다. 없으면 조용히 건너뜁니다)

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ---- 준비 ----
PGBIN=""
for d in /usr/lib/postgresql/*/bin; do [ -x "$d/initdb" ] && PGBIN="$d"; done
if [ -z "$PGBIN" ]; then
  echo "ℹ️ PostgreSQL 이 없어 보안 규칙 시험을 건너뜁니다."
  exit 0
fi
export PATH="$PGBIN:$PATH"

# postgres 는 root 로 못 돕니다. 필요하면 postgres 계정을 빌립니다.
RUN=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || { echo "ℹ️ postgres 계정이 없어 건너뜁니다."; exit 0; }
  RUN="su postgres -c"
fi

DATA=$(mktemp -d /var/tmp/authtest.XXXXXX)
SOCK=/var/tmp
chmod 777 "$DATA"
[ -n "$RUN" ] && chown postgres "$DATA"

run() { if [ -n "$RUN" ]; then su postgres -c "PATH=$PGBIN:\$PATH $1"; else bash -c "$1"; fi; }

cleanup() {
  run "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1
  rm -rf "$DATA"
}
trap cleanup EXIT

run "initdb -D $DATA -U postgres --auth=trust" >/dev/null 2>&1 || {
  echo "ℹ️ 시험용 데이터베이스를 만들지 못해 건너뜁니다."; exit 0; }
run "pg_ctl -D $DATA -o '-k $SOCK -h \"\"' -l $DATA/log start" >/dev/null 2>&1
sleep 1
run "psql -h $SOCK -U postgres -tAc 'select 1'" >/dev/null 2>&1 || {
  echo "ℹ️ 시험용 데이터베이스가 뜨지 않아 건너뜁니다."; exit 0; }

psqlq() { run "psql -h $SOCK -U postgres -q -f $1" 2>&1; }

# ⚠️ SET ROLE 같은 명령도 'SET' 을 한 줄 찍습니다. 마지막 줄만 봐야
#    숫자가 'SET0' 처럼 붙어 나오지 않습니다. (2026-08-09 실제로 겪음)
ask()   { run "psql -h $SOCK -U postgres -tAc \"$1\"" 2>&1 | tail -1 | tr -d '[:space:]'; }

# ---- Supabase 를 흉내 냅니다 (역할·auth 스키마) ----
cat > "$DATA/fake-supabase.sql" <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text
);
-- 실제 Supabase 는 로그인 표(JWT)에서 사용자 번호를 꺼냅니다.
-- 여기서는 설정값으로 흉내 냅니다.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL
chmod 644 "$DATA/fake-supabase.sql"
psqlq "$DATA/fake-supabase.sql" | grep -v NOTICE | grep -i error && {
  echo "❌ 흉내 내기 실패"; exit 1; }

cp "$ROOT/db/schema.sql" "$ROOT/db/rls.sql" "$ROOT/db/auth.sql" "$DATA/"
chmod 644 "$DATA"/*.sql
psqlq "$DATA/schema.sql" >/dev/null
psqlq "$DATA/rls.sql"    >/dev/null

# ---- 사람 둘: 관리자 / 보기 전용 ----
cat > "$DATA/people.sql" <<'SQL'
INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'boss@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'friend@example.com');

INSERT INTO stores(id, name, code) VALUES (1, '교보문고', 'kyobo');
INSERT INTO store_books(id, store_id, store_book_key, raw_title, norm_title)
VALUES (1, 1, 'a', '싯다르타', '싯다르타'),
       (2, 1, 'b', '싯다르타', '싯다르타');
INSERT INTO book_matches(id, store_book_a, store_book_b, score, reasons, decision)
VALUES (1, 1, 2, 88, '{}'::jsonb, 'auto_low');
SQL
chmod 644 "$DATA/people.sql"
psqlq "$DATA/people.sql" >/dev/null

# auth.sql 의 관리자 이메일을 시험용으로 바꿔서 실행합니다
sed -i "s/hssh8159@gmail.com/boss@example.com/" "$DATA/auth.sql"
psqlq "$DATA/auth.sql" > "$DATA/authout.txt"

FAILED=0
check() {   # check "이름" "기대" "실제"
  if [ "$2" = "$3" ]; then
    echo "  ✅ $1"
  else
    echo "  ❌ $1"
    echo "       기대: $2   실제: $3"
    FAILED=$((FAILED + 1))
  fi
}

BOSS="00000000-0000-0000-0000-000000000001"
FRIEND="00000000-0000-0000-0000-000000000002"

# 어떤 사람인 척하고 시켜 보는 도구.
#
# ⚠️ '오류가 안 났다' 를 성공으로 세면 안 됩니다.
#    보안 규칙에 막히면 오류 없이 **0줄이 바뀝니다.** 그것도 막힌 것입니다.
#    이 함정 때문에 처음에 "보기 전용 회원이 판단을 고칠 수 있다" 는
#    엉뚱한 결과가 나왔습니다. (2026-08-09)
#
# 돌려주는 값: ok(실제로 바뀜) | blocked(오류 또는 0줄)
try() {  # try <사용자uuid> <SQL>
  local out
  out=$(run "psql -h $SOCK -U postgres -tAc \"
      SET ROLE authenticated;
      SET request.jwt.claim.sub = '$1';
      $2\"" 2>&1)
  if echo "$out" | grep -qi "error\|denied\|violates"; then
    echo "blocked"
  elif echo "$out" | grep -qE "^(UPDATE|DELETE|INSERT)[ 0-9]* 0$"; then
    echo "blocked"
  else
    echo "ok"
  fi
}

echo "=================================================================="
echo "  보안 규칙 (db/auth.sql) — 진짜 데이터베이스로 시험"
echo "=================================================================="

echo ""
echo "[1] 안내표가 전부 ✅ 로 나오는가"
check "확인표에 ❌ 가 없다" "0" "$(grep -c '❌' "$DATA/authout.txt")"

echo ""
echo "[2] 로그인 안 한 사람(anon)"
for t in rankings book_matches books store_books categories; do
  n=$(ask "SET ROLE anon; SELECT count(*) FROM $t;")
  check "$t 를 못 읽는다" "0" "$n"
done

echo ""
echo "[3] 보기 전용 회원 (친구)"
check "순위는 읽을 수 있다" "1" "$(ask "SET ROLE authenticated; SET request.jwt.claim.sub='$FRIEND'; SELECT count(*) FROM book_matches;")"
check "판단을 못 고친다" "blocked" \
  "$(try "$FRIEND" "UPDATE book_matches SET decision='manual_merge', decided_by='$FRIEND' WHERE id=1;")"
check "스스로 관리자가 못 된다" "blocked" \
  "$(try "$FRIEND" "UPDATE profiles SET role='admin' WHERE id='$FRIEND';")"
check "남의 계정 정보를 못 본다" "0" \
  "$(ask "SET ROLE authenticated; SET request.jwt.claim.sub='$FRIEND'; SELECT count(*) FROM profiles WHERE id<>'$FRIEND';")"

echo ""
echo "[4] 관리자 (대표님)"
check "판단을 고칠 수 있다" "ok" \
  "$(try "$BOSS" "UPDATE book_matches SET decision='manual_merge', decided_by='$BOSS' WHERE id=1;")"
check "실제로 저장됐다" "manual_merge" "$(ask "SELECT decision FROM book_matches WHERE id=1;")"
check "되돌리기(이름 지우기)가 된다" "ok" \
  "$(try "$BOSS" "UPDATE book_matches SET decision='auto_low', decided_by=NULL WHERE id=1;")"
check "점수는 못 고친다" "blocked" \
  "$(try "$BOSS" "UPDATE book_matches SET score=100 WHERE id=1;")"
check "짝(어느 책과 어느 책)은 못 바꾼다" "blocked" \
  "$(try "$BOSS" "UPDATE book_matches SET store_book_b=1 WHERE id=1;")"
check "남의 이름으로 결정을 못 남긴다" "blocked" \
  "$(try "$BOSS" "UPDATE book_matches SET decision='manual_merge', decided_by='$FRIEND' WHERE id=1;")"
check "줄을 새로 못 만든다" "blocked" \
  "$(try "$BOSS" "INSERT INTO book_matches(store_book_a,store_book_b,score,reasons,decision) VALUES (2,1,50,'{}','auto_low');")"
check "줄을 못 지운다" "blocked" \
  "$(try "$BOSS" "DELETE FROM book_matches WHERE id=1;")"
check "순위는 못 고친다" "blocked" \
  "$(try "$BOSS" "UPDATE store_books SET raw_title='바뀜' WHERE id=1;")"

echo ""
echo "[5] 수집 작업(service_role)은 계속 돌아야 한다"
check "관리자 열쇠는 순위를 쓸 수 있다" "ok" \
  "$(run "psql -h $SOCK -U postgres -tAc \"SET ROLE service_role; UPDATE store_books SET raw_title='수집갱신' WHERE id=1;\"" >/dev/null 2>&1 && echo ok || echo blocked)"

echo ""
echo "=================================================================="
if [ "$FAILED" -gt 0 ]; then
  echo "  ❌ 실패 $FAILED 건 — 보안 규칙이 의도대로 막지 않습니다."
  exit 1
fi
echo "  ✅ 전부 통과"
