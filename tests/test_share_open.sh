#!/usr/bin/env bash
#
# 공유 링크 '회원 공개' 가 실제로 되는지, 진짜 데이터베이스로 시험합니다.
#
# 【왜 필요한가요? — 2026-08-10】
# 대표님이 db/share-open.sql 을 실행하시고 확인표가 전부 ✅ 였는데도
# 사이트에는 계속 "관리자만 볼 수 있습니다" 가 떴습니다.
#
# 원인은 **덮어쓰기 순서**입니다. db/share.sql 과 db/share-open.sql 은
# 같은 이름의 함수 세 개(my_share_links / create_share_link /
# set_share_link)를 각각 정의합니다. 나중에 실행한 쪽이 이깁니다.
# 그런데 회원 공개가 안 될 때 사이트가 띄우던 안내가 하필
# "db/share.sql 을 실행하세요" 였습니다. 그대로 하시면 되돌아갑니다.
#
# 눈으로는 구분이 안 됩니다. 두 경우 다 화면은 똑같이 생겼습니다.
# 그래서 기계가 봅니다.
#
#   · share.sql 만 실행한 상태  → 회원은 막혀야 함 (지금 겪고 계신 증상)
#   · 그 위에 share-open.sql    → 회원이 자기 링크를 봐야 함
#   · 그 위에 share.sql 을 또   → 🚨 다시 막힘 (이게 함정입니다)
#
# 실행: bash tests/test_share_open.sh
# (PostgreSQL 이 깔려 있어야 합니다. 없으면 조용히 건너뜁니다)

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PGBIN=""
for d in /usr/lib/postgresql/*/bin; do [ -x "$d/initdb" ] && PGBIN="$d"; done
if [ -z "$PGBIN" ]; then
  echo "ℹ️ PostgreSQL 이 없어 공유 링크 시험을 건너뜁니다."
  exit 0
fi
export PATH="$PGBIN:$PATH"

RUN=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || { echo "ℹ️ postgres 계정이 없어 건너뜁니다."; exit 0; }
  RUN="su postgres -c"
fi

DATA=$(mktemp -d /var/tmp/sharetest.XXXXXX)
SOCK=/var/tmp
# 이 컴퓨터에 이미 돌고 있는 다른 PostgreSQL 에 붙지 않도록 포트를 따로 잡습니다.
PORT=$(( 15432 + (RANDOM % 2000) ))
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
run "pg_ctl -D $DATA -o '-k $SOCK -p $PORT -h \"\"' -l $DATA/log start" >/dev/null 2>&1
sleep 1
run "psql -h $SOCK -p $PORT -U postgres -tAc 'select 1'" >/dev/null 2>&1 || {
  echo "ℹ️ 시험용 데이터베이스가 뜨지 않아 건너뜁니다."; exit 0; }

psqlq() { run "psql -h $SOCK -p $PORT -U postgres -q -f $1" 2>&1; }

# ---- Supabase 를 흉내 냅니다 ----
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
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL
chmod 644 "$DATA/fake-supabase.sql"
psqlq "$DATA/fake-supabase.sql" | grep -v NOTICE | grep -i error && {
  echo "❌ 흉내 내기 실패"; exit 1; }

cp "$ROOT/db/schema.sql" "$ROOT/db/rls.sql" "$ROOT/db/auth.sql" \
   "$ROOT/db/share.sql" "$ROOT/db/share-open.sql" "$DATA/"
chmod 644 "$DATA"/*.sql
psqlq "$DATA/schema.sql" >/dev/null
psqlq "$DATA/rls.sql"    >/dev/null

cat > "$DATA/people.sql" <<'SQL'
INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'boss@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'friend@example.com');
INSERT INTO categories(id, store_id, name, kind, code, url_template, enabled)
VALUES (10, 1, '소설', 'online', 'novel', 'https://example.test/{page}', true);
SQL
chmod 644 "$DATA/people.sql"
psqlq "$DATA/people.sql" >/dev/null

sed -i "s/hssh8159@gmail.com/boss@example.com/" "$DATA/auth.sql"
psqlq "$DATA/auth.sql" >/dev/null

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

# 그 사람인 척하고 시켜 봅니다.
# 돌려주는 값: ok | 오류 메시지의 핵심 조각
as() {  # as <사용자uuid> <SQL>
  local out
  out=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"
      SET ROLE authenticated;
      SET request.jwt.claim.sub = '$1';
      $2\"" 2>&1)
  if echo "$out" | grep -q "관리자만"; then echo "관리자만"
  elif echo "$out" | grep -q "로그인이 필요"; then echo "로그인필요"
  elif echo "$out" | grep -qi "error"; then echo "오류:$(echo "$out" | head -2 | tr '\n' ' ')"
  else echo "ok"
  fi
}

# 로그인 안 한 사람인 척 (사용자 번호를 아예 안 넣습니다)
as_anon() {
  local out
  out=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"
      SET ROLE authenticated;
      $1\"" 2>&1)
  if echo "$out" | grep -q "관리자만"; then echo "관리자만"
  elif echo "$out" | grep -q "로그인이 필요"; then echo "로그인필요"
  else echo "ok"
  fi
}

# 지금 깔려 있는 my_share_links 가 어느 쪽인지
which_version() {
  run "psql -h $SOCK -p $PORT -U postgres -tAc \"
    SELECT CASE
      WHEN to_regprocedure('public.my_share_links()') IS NULL THEN '없음'
      WHEN pg_get_functiondef(to_regprocedure('public.my_share_links()'))
           LIKE '%관리자만 볼 수 있습니다%' THEN '옛것'
      ELSE '새것' END\"" 2>&1 | tail -1 | tr -d '[:space:]'
}

echo
echo "[1] db/share.sql 만 실행한 상태 — 대표님이 지금 겪고 계신 증상"
psqlq "$DATA/share.sql" >/dev/null
check "깔린 것은 옛 함수" "옛것" "$(which_version)"
# 🚨 이 한 줄이 대표님 화면에 뜬 그 문장입니다.
check "회원이 목록을 보면 막힌다" "관리자만" "$(as "$FRIEND" 'SELECT * FROM my_share_links();')"
check "회원이 링크를 못 만든다" "관리자만" \
  "$(as "$FRIEND" "SELECT create_share_link('ranking','10','내 링크',3);")"
check "관리자는 된다" "ok" "$(as "$BOSS" 'SELECT * FROM my_share_links();')"

echo
echo "[2] 그 위에 db/share-open.sql — 회원에게 열립니다"
psqlq "$DATA/share-open.sql" >/dev/null
check "깔린 것은 새 함수" "새것" "$(which_version)"
check "회원이 목록을 볼 수 있다" "ok" "$(as "$FRIEND" 'SELECT * FROM my_share_links();')"
check "회원이 링크를 만들 수 있다" "ok" \
  "$(as "$FRIEND" "SELECT create_share_link('ranking','10','친구 링크',3);")"
check "관리자도 그대로 된다" "ok" "$(as "$BOSS" 'SELECT * FROM my_share_links();')"
# 로그인 안 한 사람은 새 함수에서도 막혀야 합니다.
#
# 🚨 여기가 이 시험에서 제일 중요한 줄입니다.
#    새 함수가 막을 때 하는 말은 '로그인이 필요합니다' 입니다.
#    '관리자만 볼 수 있습니다' 는 **옛 함수만 할 줄 아는 말**입니다.
#    그래서 화면에 뜬 문구만 보고도 어느 함수가 돌고 있는지 알 수 있습니다.
check "로그인 안 하면 막힌다 — 말이 '로그인이 필요합니다' 다" "로그인필요" \
  "$(as_anon 'SELECT * FROM my_share_links();')"

echo
echo "[3] 회원끼리 서로 못 건드린다"
# 회원이 만든 링크의 주소값을 관리자 권한으로 꺼내 옵니다
FRIEND_TOKEN=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"
  SELECT token FROM public_links WHERE created_by = '$FRIEND' LIMIT 1\"" 2>&1 | tail -1 | tr -d '[:space:]')
BOSS_TOKEN=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"
  INSERT INTO public_links(token, kind, target_id, label, created_by)
  VALUES ('bosslink', 'ranking', '10', '대표님 것', '$BOSS') RETURNING token\"" 2>&1 | tail -1 | tr -d '[:space:]')
check "회원 링크가 실제로 만들어졌다" "ok" \
  "$([ -n "$FRIEND_TOKEN" ] && echo ok || echo 없음)"
# 🚨 남의 링크를 끄면 안 됩니다. 데이터베이스가 false 를 돌려줘야 합니다.
GOT=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '$FRIEND';
    SELECT set_share_link('$BOSS_TOKEN', false);\"" 2>&1 | tail -1 | tr -d '[:space:]')
check "회원이 남의 링크를 못 끈다" "f" "$GOT"
GOT=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '$FRIEND';
    SELECT set_share_link('$FRIEND_TOKEN', false);\"" 2>&1 | tail -1 | tr -d '[:space:]')
check "자기 링크는 끌 수 있다" "t" "$GOT"
# 회원 목록에는 자기 것만 보여야 합니다
GOT=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '$FRIEND';
    SELECT count(*) FROM my_share_links();\"" 2>&1 | tail -1 | tr -d '[:space:]')
check "회원 목록에는 자기 것만 (1건)" "1" "$GOT"
GOT=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '$BOSS';
    SELECT count(*) FROM my_share_links();\"" 2>&1 | tail -1 | tr -d '[:space:]')
check "관리자 목록에는 전부 (2건)" "2" "$GOT"

echo
echo "[4] 🚨 share.sql 을 나중에 또 실행하면 — 반만 되돌아갑니다"
#
# 【2026-08-10 — 실제로 돌려보고 알게 된 것】
# 저는 처음에 "share.sql 을 나중에 실행하면 전부 되돌아간다" 고
# 대표님께 말씀드렸습니다. **틀렸습니다.** 진짜 PostgreSQL 로 돌려보니
# 그렇지 않았습니다.
#
#   · my_share_links   → 안 되돌아갑니다.
#     share.sql 은 CREATE OR REPLACE 로 7칸짜리를 만들려 하는데,
#     이미 9칸짜리가 있어서 PostgreSQL 이 거절합니다
#     ("cannot change return type of existing function"). 그 줄만 실패하고
#     나머지는 그대로 실행됩니다.
#
#   · create_share_link → 되돌아갑니다. 칸 모양이 같아서 그냥 덮입니다.
#
# 그래서 증상이 반쪽으로 납니다. **목록은 보이는데 만들기만 막힙니다.**
# 이 구분이 중요한 이유: 화면에 '관리자만 볼 수 있습니다'(목록) 가 떴다면
# share.sql 을 나중에 실행한 것이 원인이 **아니라는** 뜻입니다.
psqlq "$DATA/share.sql" >/dev/null
check "목록 함수는 살아남는다 (덮어쓰기가 거절됨)" "새것" "$(which_version)"
check "회원이 목록은 계속 볼 수 있다" "ok" "$(as "$FRIEND" 'SELECT * FROM my_share_links();')"
check "만들기만 되돌아가 막힌다" "관리자만" \
  "$(as "$FRIEND" "SELECT create_share_link('ranking','10','또',3);")"

echo
echo "[5] 다시 share-open.sql 을 실행하면 완전히 복구된다"
psqlq "$DATA/share-open.sql" >/dev/null
check "목록 함수 새것" "새것" "$(which_version)"
check "회원이 목록을 본다" "ok" "$(as "$FRIEND" 'SELECT * FROM my_share_links();')"
check "회원이 다시 만들 수 있다" "ok" \
  "$(as "$FRIEND" "SELECT create_share_link('ranking','10','복구',3);")"

echo
if [ "$FAILED" -gt 0 ]; then
  echo "❌ $FAILED 개 실패"
  exit 1
fi
echo "✅ 공유 링크 회원 공개 시험 전부 통과"
