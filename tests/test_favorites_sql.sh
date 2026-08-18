#!/usr/bin/env bash
#
# 즐겨찾기(db/favorites.sql)를 **진짜 데이터베이스**로 시험합니다.
#
# 【2026-08-18 대표님 요청】
#   "각 아이디 이용자마다 도서를 즐겨찾기 할 수 있는 기능…
#    즐겨찾기 목록에 있는 도서가 장기간 업데이트가 안 돼서 지워질 경우,
#    그 이용자에게 매일 어떤 도서가 지워졌다고 안내문 정도만 남길 수 있나?"
#
# 【왜 진짜 데이터베이스로 하나요?】
# 여기서 틀리면 **화면은 멀쩡해 보입니다.**
#   · 남의 즐겨찾기가 새어 나가도 대표님 화면에는 아무 표시가 안 납니다
#   · 안내문이 안 떠도 "지워진 책이 없나 보다" 로 읽힙니다
#   · 반대로 거짓 안내문이 매일 뜨면 진짜 안내문을 못 봅니다
# 눈으로 확인할 수 없는 종류라 기계가 실제로 시켜 봅니다.
#
# 실행: bash tests/test_favorites_sql.sh
# (PostgreSQL 이 깔려 있어야 합니다. 없으면 조용히 건너뜁니다)

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PGBIN=""
for d in /usr/lib/postgresql/*/bin; do [ -x "$d/initdb" ] && PGBIN="$d"; done
if [ -z "$PGBIN" ]; then
  echo "ℹ️ PostgreSQL 이 없어 즐겨찾기 시험을 건너뜁니다."
  exit 0
fi
export PATH="$PGBIN:$PATH"

RUN=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || { echo "ℹ️ postgres 계정이 없어 건너뜁니다."; exit 0; }
  RUN="su postgres -c"
fi

DATA=$(mktemp -d /var/tmp/favtest.XXXXXX)
SOCK=/var/tmp
# 이 컴퓨터에 이미 돌고 있는 다른 PostgreSQL 에 붙지 않도록 포트를 따로 잡습니다.
PORT=$(( 17432 + (RANDOM % 2000) ))
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
# ⚠️ SET ROLE 같은 명령도 한 줄을 찍습니다. 마지막 줄만 봐야 값이 붙어
#    나오지 않습니다 (tests/test_auth_sql.sh 의 2026-08-09 기록 참고).
ask() { run "psql -h $SOCK -p $PORT -U postgres -tAc \"$1\"" 2>&1 | tail -1 | tr -d '[:space:]'; }

# ---- Supabase 흉내 (역할·auth 스키마) ----
cat > "$DATA/fake-supabase.sql" <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL
chmod 644 "$DATA/fake-supabase.sql"
psqlq "$DATA/fake-supabase.sql" | grep -v NOTICE | grep -i error && {
  echo "❌ 흉내 내기 실패"; exit 1; }

cp "$ROOT/db/schema.sql" "$ROOT/db/rls.sql" "$ROOT/db/auth.sql" \
   "$ROOT/db/favorites.sql" "$DATA/"
chmod 644 "$DATA"/*.sql
psqlq "$DATA/schema.sql" >/dev/null
psqlq "$DATA/rls.sql"    >/dev/null

cat > "$DATA/people.sql" <<'SQL'
INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'boss@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'friend@example.com');
SQL
chmod 644 "$DATA/people.sql"
psqlq "$DATA/people.sql" >/dev/null

sed -i "s/hssh8159@gmail.com/boss@example.com/" "$DATA/auth.sql"
psqlq "$DATA/auth.sql" >/dev/null

# 🚨 여기가 요점입니다. auth.sql 을 **나중에 다시 돌려도** 즐겨찾기가
#    열리면 안 됩니다. auth.sql 은 표 목록을 돌며 "회원만 읽기(누구나)"
#    규칙을 붙이는데, 거기에 favorites 가 끼면 남의 즐겨찾기가 전부
#    보이게 됩니다. 순서를 바꿔 가며 두 번 확인합니다.
psqlq "$DATA/favorites.sql" > "$DATA/favout.txt"
psqlq "$DATA/auth.sql" >/dev/null      # 다시 한 번 (실제로 그러실 수 있습니다)

# ---- 시험용 자료 ----
cat > "$DATA/data.sql" <<'SQL'
INSERT INTO books(id, title, author, publisher) VALUES
  (1, '빛과 수의 시대 1', '김상욱', '동아시아'),
  (2, '코스모스',         '칼 세이건', '사이언스북스'),
  (3, '사라질 책',        '아무개', '아무곳');
INSERT INTO store_books(id, store_id, store_book_key, raw_title, norm_title, book_id)
VALUES (10, 1, 'k10', '빛과 수의 시대 1', '빛과수의시대1', 1),
       (11, 2, 'k11', '빛과 수의 시대 1', '빛과수의시대1', 1),
       (12, 3, 'k12', '코스모스',         '코스모스',      2),
       (13, 1, 'k13', '사라질 책',        '사라질책',      3);
INSERT INTO categories(id, store_id, name, kind, code, url_template, unified_code, enabled)
VALUES (100, 1, '종합', 'online', 'all1',  'https://e.test/{page}', 'all',   true),
       (101, 2, '종합', 'online', 'all2',  'https://e.test/{page}', 'all',   true),
       (102, 3, '소설', 'online', 'novel', 'https://e.test/{page}', 'novel', true);
INSERT INTO rankings(snapshot_date, category_id, rank, store_book_id, sales_point)
VALUES ('2026-08-18', 100, 5, 10, NULL),
       ('2026-08-18', 101, 9, 11, 120),
       ('2026-08-18', 102, 3, 12, 90);
SQL
chmod 644 "$DATA/data.sql"
psqlq "$DATA/data.sql" >/dev/null

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

# 어떤 사람인 척하고 시켜 봅니다.
# ⚠️ '오류가 안 났다' 를 성공으로 세면 안 됩니다. 보안 규칙에 막히면
#    오류 없이 **0줄이 바뀝니다.** 그것도 막힌 것입니다.
try() {  # try <사용자uuid> <SQL>
  local out
  out=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"
      SET ROLE authenticated;
      SET request.jwt.claim.sub = '$1';
      $2\"" 2>&1)
  if echo "$out" | grep -qi "error\|denied\|violates"; then echo "blocked"
  elif echo "$out" | grep -qE "^(UPDATE|DELETE|INSERT)[ 0-9]* 0$"; then echo "blocked"
  else echo "ok"; fi
}
asme() { # asme <사용자uuid> <SQL>  — 값을 읽어옵니다
  run "psql -h $SOCK -p $PORT -U postgres -tAc \"
      SET ROLE authenticated;
      SET request.jwt.claim.sub = '$1';
      $2\"" 2>&1 | tail -1 | tr -d '[:space:]'
}

echo "=================================================================="
echo "  즐겨찾기 (db/favorites.sql) — 진짜 데이터베이스로 시험"
echo "=================================================================="

echo ""
echo "[1] 담을 수 있는가"
check "대표님이 세 권을 담는다" "ok" \
  "$(try "$BOSS" "INSERT INTO favorites(user_id,book_id,title,author,publisher)
      VALUES (auth.uid(),1,'빛과 수의 시대 1','김상욱','동아시아'),
             (auth.uid(),2,'코스모스','칼 세이건','사이언스북스'),
             (auth.uid(),3,'사라질 책','아무개','아무곳');")"
check "내 목록은 3권" "3" "$(asme "$BOSS" "SELECT count(*) FROM favorites;")"
check "같은 책을 두 번은 못 담는다" "blocked" \
  "$(try "$BOSS" "INSERT INTO favorites(user_id,book_id,title)
      VALUES (auth.uid(),1,'빛과 수의 시대 1');")"

echo ""
echo "[2] 🚨 남의 즐겨찾기 — 화면이 아니라 데이터베이스가 막아야 합니다"
check "남의 목록은 안 보인다" "0" "$(asme "$FRIEND" "SELECT count(*) FROM favorites;")"
check "남의 이름으로 담지 못한다" "blocked" \
  "$(try "$FRIEND" "INSERT INTO favorites(user_id,book_id,title) VALUES ('$BOSS',2,'훔치기');")"
check "남의 줄을 지우지 못한다" "blocked" \
  "$(try "$FRIEND" "DELETE FROM favorites WHERE title='코스모스';")"
check "남의 줄을 내 것으로 바꾸지 못한다" "blocked" \
  "$(try "$FRIEND" "UPDATE favorites SET book_id=1 WHERE title='코스모스';")"
check "로그인 안 한 사람은 아예 못 읽는다" "0" \
  "$(ask "SET ROLE anon; SELECT count(*) FROM favorites;" | grep -c '^[0-9]*$' )"
ANON=$(ask "SET ROLE anon; SELECT count(*) FROM favorites;")
check "로그인 안 한 사람은 막힌다(권한 오류)" "1" \
  "$(echo "$ANON" | grep -ci 'denied\|error')"

echo ""
echo "[3] 3사 자료를 종합 화면과 같은 모양으로 돌려주는가"
check "묶인 두 서점의 순위를 준다" "7.0" \
  "$(asme "$BOSS" "SELECT avg_rank FROM books_by_ids(ARRAY[1]::bigint[],'2026-08-18','daily','all',300);")"
check "판매지수도 준다" "120" \
  "$(asme "$BOSS" "SELECT sales->>'2' FROM books_by_ids(ARRAY[1]::bigint[],'2026-08-18','daily','all',300);")"
# 🚨 순위가 없는 책이 목록에서 소리 없이 사라지면 안 됩니다.
check "순위가 없어도 줄은 나온다" "3" \
  "$(asme "$BOSS" "SELECT count(*) FROM books_by_ids(ARRAY[1,2,3]::bigint[],'2026-08-18','daily','all',300);")"
check "없는 순위를 0 으로 채우지 않는다" "0" \
  "$(asme "$BOSS" "SELECT store_count FROM books_by_ids(ARRAY[2]::bigint[],'2026-08-18','daily','all',300);")"
check "평균 순위는 비워 둔다(0 이 아님)" "t" \
  "$(asme "$BOSS" "SELECT avg_rank IS NULL FROM books_by_ids(ARRAY[2]::bigint[],'2026-08-18','daily','all',300);")"
# 종합에는 없지만 소설 3위인 책 — '분야 상위' 기준에서는 보여야 합니다
check "분야 상위(*) 기준에서는 소설 3위가 잡힌다" "3.0" \
  "$(asme "$BOSS" "SELECT avg_rank FROM books_by_ids(ARRAY[2]::bigint[],'2026-08-18','daily','*',300);")"

echo ""
echo "[4] 🚨 책이 지워지면 — 소리 없이 사라지지 않고 안내문이 남는가"
run "psql -h $SOCK -p $PORT -U postgres -tAc \"DELETE FROM books WHERE id=3;\"" >/dev/null 2>&1
check "즐겨찾기 줄은 살아남는다" "3" "$(asme "$BOSS" "SELECT count(*) FROM favorites;")"
check "제목이 남아 있다" "사라질책" \
  "$(asme "$BOSS" "SELECT title FROM favorites WHERE book_id IS NULL;")"
check "'사라졌다' 고 적힌다" "t" \
  "$(asme "$BOSS" "SELECT removed_at IS NOT NULL FROM favorites WHERE title='사라질 책';")"
check "아직 확인 안 한 안내문이 1건" "1" \
  "$(asme "$BOSS" "SELECT count(*) FROM favorites WHERE removed_at IS NOT NULL AND noticed_at IS NULL;")"
check "확인하면 안내문이 내려간다" "0" \
  "$(asme "$BOSS" "UPDATE favorites SET noticed_at=now() WHERE removed_at IS NOT NULL;
      SELECT count(*) FROM favorites WHERE removed_at IS NOT NULL AND noticed_at IS NULL;")"

echo ""
echo "[5] 🚨 거짓 안내문이 뜨지 않는가 (여기가 가장 중요합니다)"
# [도서 매칭] 은 묶음이 바뀌면 도서 번호를 새로 매깁니다. 2026-08-18
# 실행에서만 552종이 그랬습니다. 그때마다 "지워졌습니다" 라고 알리면
# 진짜 안내문을 아무도 안 보게 됩니다.
run "psql -h $SOCK -p $PORT -U postgres -tAc \"
  DELETE FROM books WHERE id=2;
  INSERT INTO books(id,title,author,publisher)
    VALUES (99,'코스모스','칼 세이건','사이언스북스');\"" >/dev/null 2>&1
check "번호만 바뀐 책은 다시 이어진다" "1" \
  "$(asme "$BOSS" "SELECT relink_my_favorites();")"
check "이어진 뒤에는 '사라짐' 표시가 없다" "t" \
  "$(asme "$BOSS" "SELECT removed_at IS NULL FROM favorites WHERE title='코스모스';")"
check "새 번호로 이어져 있다" "99" \
  "$(asme "$BOSS" "SELECT book_id FROM favorites WHERE title='코스모스';")"

# 이름이 같은 책이 둘이면 어느 것인지 알 수 없습니다. 짐작하지 않습니다.
run "psql -h $SOCK -p $PORT -U postgres -tAc \"
  DELETE FROM books WHERE id=99;
  INSERT INTO books(id,title,author,publisher)
    VALUES (200,'코스모스','칼 세이건','사이언스북스'),
           (201,'코스모스','칼 세이건','사이언스북스');\"" >/dev/null 2>&1
check "이름이 같은 책이 둘이면 짐작해서 잇지 않는다" "0" \
  "$(asme "$BOSS" "SELECT relink_my_favorites();")"
check "그럴 때는 '사라짐' 으로 남는다" "t" \
  "$(asme "$BOSS" "SELECT removed_at IS NOT NULL FROM favorites WHERE title='코스모스';")"

echo ""
echo "[6] 🚨 auth.sql 을 다시 돌려도 남의 즐겨찾기가 열리지 않는가"
# auth.sql 은 표 목록을 돌며 '회원이면 누구나 읽기' 규칙을 붙입니다.
# 거기에 favorites 가 끼면 회원 전원의 즐겨찾기가 서로에게 보입니다.
check "'누구나 읽기' 규칙이 안 붙어 있다" "0" \
  "$(ask "SELECT count(*) FROM pg_policies
           WHERE tablename='favorites' AND qual='true';")"
check "내 것만 보는 규칙이 살아 있다" "1" \
  "$(ask "SELECT count(*) FROM pg_policies
           WHERE tablename='favorites' AND policyname='내 것만 보기';")"
check "남의 목록은 여전히 안 보인다" "0" "$(asme "$FRIEND" "SELECT count(*) FROM favorites;")"

echo ""
if [ "$FAILED" -gt 0 ]; then
  echo "❌ $FAILED 개 실패"
  exit 1
fi
echo "✅ 모두 통과"
