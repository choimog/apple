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

# ⚠️ 포트를 따로 잡습니다.
#    처음에는 기본 포트를 그대로 썼는데, 그러면 이 컴퓨터에 이미 돌고 있는
#    다른 PostgreSQL 에 붙어 버립니다. 실제로 그래서 시험이 엉뚱한 곳을
#    보고 "역할이 이미 있습니다" 로 무너졌습니다. (2026-08-09)
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

# ⚠️ SET ROLE 같은 명령도 'SET' 을 한 줄 찍습니다. 마지막 줄만 봐야
#    숫자가 'SET0' 처럼 붙어 나오지 않습니다. (2026-08-09 실제로 겪음)
ask()   { run "psql -h $SOCK -p $PORT -U postgres -tAc \"$1\"" 2>&1 | tail -1 | tr -d '[:space:]'; }

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

cp "$ROOT/db/schema.sql" "$ROOT/db/rls.sql" "$ROOT/db/auth.sql" \
   "$ROOT/db/share.sql" "$ROOT/db/share-open.sql" "$DATA/"
chmod 644 "$DATA"/*.sql
psqlq "$DATA/schema.sql" >/dev/null
psqlq "$DATA/rls.sql"    >/dev/null

# ---- 사람 둘: 관리자 / 보기 전용 ----
cat > "$DATA/people.sql" <<'SQL'
INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'boss@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'friend@example.com');

-- stores 는 schema.sql 이 이미 넣어 둡니다 (여기서 또 넣으면 중복 오류)
INSERT INTO store_books(id, store_id, store_book_key, raw_title, norm_title)
VALUES (1, 1, 'a', '싯다르타', '싯다르타'),
       (2, 1, 'b', '싯다르타', '싯다르타');
INSERT INTO book_matches(id, store_book_a, store_book_b, score, reasons, decision)
VALUES (1, 1, 2, 88, '{}'::jsonb, 'auto_low');

-- 공유 링크 시험용: 분야 둘과 순위 몇 줄
-- ⚠️ url_template 은 NOT NULL 입니다. 빠뜨리면 이 줄만 조용히 안 들어가고,
--    공유 링크 시험이 '읽을 게 없어서' 실패합니다. (2026-08-09 실제로 겪음)
INSERT INTO categories(id, store_id, name, kind, code, url_template, enabled)
VALUES (10, 1, '소설', 'online', 'novel', 'https://example.test/{page}', true),
       (20, 1, '경제', 'online', 'econ',  'https://example.test/{page}', true);
INSERT INTO rankings(snapshot_date, category_id, rank, store_book_id, sales_point)
VALUES ('2026-08-09', 10, 1, 1, 100),
       ('2026-08-09', 10, 2, 2, 90),
       ('2026-08-09', 20, 1, 2, 80);
SQL
chmod 644 "$DATA/people.sql"
psqlq "$DATA/people.sql" >/dev/null

# auth.sql 의 관리자 이메일을 시험용으로 바꿔서 실행합니다
sed -i "s/hssh8159@gmail.com/boss@example.com/" "$DATA/auth.sql"
psqlq "$DATA/auth.sql" > "$DATA/authout.txt"
psqlq "$DATA/share.sql" > "$DATA/shareout.txt"

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
  out=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"
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

# 로그인 안 한 사람(anon)으로 해 봅니다.
try_anon() {  # try_anon <SQL>
  local out
  out=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"
      SET ROLE anon;
      $1\"" 2>&1)
  if echo "$out" | grep -qi "error\|denied\|violates"; then
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
echo "[5] 공유 링크 — 로그인 없이 순위표 하나만"

# 관리자인 척하고 링크를 하나 만듭니다
TOKEN=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '$BOSS';
    SELECT create_share_link('ranking','10','소설 일간',NULL);\"" 2>&1 | tail -1 | tr -d '[:space:]')


# ⚠️ 길이를 정확히 봅니다. 만들기가 실패하면 오류 메시지가 TOKEN 에 담기는데,
#    그것도 길어서 "32글자 이상" 같은 느슨한 검사는 통과해 버립니다.
#    실제로 그래서 '됐다' 고 나왔는데 링크는 없었습니다. (2026-08-09)
check "링크가 만들어졌다 (주소값 64글자)" "yes" \
  "$(if [ ${#TOKEN} = 64 ]; then echo yes; else echo "no(${#TOKEN}글자: ${TOKEN:0:60})"; fi)"

check "보기 전용 회원은 못 만든다" "blocked" \
  "$(try "$FRIEND" "SELECT create_share_link('ranking','10','몰래',NULL);")"

check "로그인 없이 그 순위표를 읽을 수 있다" "2" \
  "$(ask "SET ROLE anon; SELECT count(*) FROM share_rankings('$TOKEN', 100);")"
check "분야 이름도 나온다" "소설" \
  "$(ask "SET ROLE anon; SELECT category_name FROM share_meta('$TOKEN');")"

# ⚠️ 여기가 핵심입니다. 주소값 하나로 '그 분야만' 열려야 합니다.
check "그 주소로 다른 분야는 못 본다" "0" \
  "$(ask "SET ROLE anon; SELECT count(*) FROM share_rankings('$TOKEN',100) WHERE sales_point=80;")"

check "없는 주소값은 빈 결과" "0" \
  "$(ask "SET ROLE anon; SELECT count(*) FROM share_rankings('없는주소값', 100);")"

# 주소값 자체가 새면 안 됩니다. 표는 계속 잠겨 있어야 합니다.
check "로그인 없이 주소값 목록을 못 본다" "0" \
  "$(ask "SET ROLE anon; SELECT count(*) FROM public_links;")"
check "보기 전용 회원도 주소값 목록을 못 본다" "0" \
  "$(ask "SET ROLE authenticated; SET request.jwt.claim.sub='$FRIEND'; SELECT count(*) FROM public_links;")"
check "보기 전용 회원은 목록 함수도 못 쓴다" "blocked" \
  "$(try "$FRIEND" "SELECT count(*) FROM my_share_links();")"

# 끄면 즉시 막혀야 합니다
run "psql -h $SOCK -p $PORT -U postgres -tAc \"
    SET ROLE authenticated; SET request.jwt.claim.sub = '$BOSS';
    SELECT set_share_link('$TOKEN', false);\"" >/dev/null 2>&1
check "끄면 바로 안 보인다" "0" \
  "$(ask "SET ROLE anon; SELECT count(*) FROM share_rankings('$TOKEN', 100);")"
check "끈 뒤에는 이름도 안 나온다" "0" \
  "$(ask "SET ROLE anon; SELECT count(*) FROM share_meta('$TOKEN');")"

# 기한이 지난 링크
run "psql -h $SOCK -p $PORT -U postgres -q -c \"
    UPDATE public_links SET enabled=true, expires_at=now()-interval '1 day'
    WHERE token='$TOKEN';\"" >/dev/null 2>&1
check "기한이 지나면 안 보인다" "0" \
  "$(ask "SET ROLE anon; SELECT count(*) FROM share_rankings('$TOKEN', 100);")"

# 한 번에 퍼갈 수 있는 양에 상한이 있어야 합니다
run "psql -h $SOCK -p $PORT -U postgres -q -c \"
    UPDATE public_links SET enabled=true, expires_at=NULL WHERE token='$TOKEN';\"" >/dev/null 2>&1
check "한 번에 300줄까지만" "2" \
  "$(ask "SET ROLE anon; SELECT count(*) FROM share_rankings('$TOKEN', 999999);")"

echo ""
echo "[5-2] 공유 링크를 회원에게 열었을 때 (db/share-open.sql)"
# 🚨 여기가 이번 변경에서 가장 위험한 부분입니다.
#    "링크를 만들 권한" 을 회원에게 나눠 주는 일이라, 조건 하나만 새면
#    회원이 남의 링크를 끄거나 남이 만든 주소를 볼 수 있게 됩니다.
psqlq "$DATA/share-open.sql" > "$DATA/openout.txt"

check "안내표가 전부 ✅" "0" \
  "$(grep -c '❌' "$DATA/openout.txt" || true)"

# 회원도 만들 수 있어야 합니다 (이번 요청의 목적)
FTOKEN=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '$FRIEND';
    SELECT create_share_link('ranking','10','친구가 만든 것',30);\"" 2>&1 | tail -1 | tr -d '[:space:]')
check "회원도 링크를 만들 수 있다 (64글자)" "yes" \
  "$(if [ ${#FTOKEN} = 64 ]; then echo yes; else echo "no(${#FTOKEN}글자: ${FTOKEN:0:60})"; fi)"

check "만든 링크는 로그인 없이 열린다" "2" \
  "$(ask "SET ROLE anon; SELECT count(*) FROM share_rankings('$FTOKEN', 100);")"

# ---- 여기부터가 진짜 자물쇠 ----
check "🚨 회원은 남(대표님)이 만든 링크를 못 본다" "0" \
  "$(ask "SET ROLE authenticated; SET request.jwt.claim.sub = '$FRIEND';
          SELECT count(*) FROM my_share_links() WHERE token = '$TOKEN';")"

check "회원은 자기 것은 본다" "1" \
  "$(ask "SET ROLE authenticated; SET request.jwt.claim.sub = '$FRIEND';
          SELECT count(*) FROM my_share_links() WHERE token = '$FTOKEN';")"

# ⚠️ try() 로 보면 안 됩니다. set_share_link 는 막혀도 오류가 아니라
#    **false 를 돌려줍니다.** 오류가 없다고 'ok' 로 세면 통과해 버립니다.
#    (2026-08-09 실제로 그렇게 잘못 나왔습니다)
check "🚨 회원은 남의 링크를 못 끈다 (false 를 돌려줌)" "f" \
  "$(ask "SET ROLE authenticated; SET request.jwt.claim.sub = '$FRIEND';
          SELECT set_share_link('$TOKEN', false);")"

check "대표님 링크는 그대로 살아 있다" "2" \
  "$(ask "SET ROLE anon; SELECT count(*) FROM share_rankings('$TOKEN', 100);")"

check "회원은 자기 것은 끌 수 있다" "ok" \
  "$(try "$FRIEND" "SELECT set_share_link('$FTOKEN', false);")"

check "끈 뒤에는 안 열린다" "0" \
  "$(ask "SET ROLE anon; SELECT count(*) FROM share_rankings('$FTOKEN', 100);")"

# 회원은 '기한 없음' 을 못 고릅니다 — 영원히 열린 주소를 막습니다
NOEXP=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '$FRIEND';
    SELECT create_share_link('ranking','10','기한없이 해보기',NULL);\"" 2>&1 | tail -1 | tr -d '[:space:]')
check "🚨 회원이 만든 링크에는 반드시 기한이 붙는다" "1" \
  "$(ask "SELECT count(*) FROM public_links
          WHERE token = '$NOEXP' AND expires_at IS NOT NULL;")"

# 【2026-08-09 대표님 지시】 "한 사람이 2개까지, 최대 3시간까지"
check "🚨 회원 기한은 3시간을 못 넘는다" "1" \
  "$(ask "SELECT count(*) FROM public_links
          WHERE token = '$NOEXP' AND expires_at <= now() + interval '3 hours 1 minute';")"

# 개수 제한 — 친구는 이미 2개(FTOKEN·NOEXP)를 만들었습니다.
# 하나는 껐으므로 살아 있는 것은 1개. 하나 더 만들면 2개가 되고,
# 그 다음은 막혀야 합니다.
run "psql -h $SOCK -p $PORT -U postgres -tAc \"
    SET ROLE authenticated; SET request.jwt.claim.sub = '$FRIEND';
    SELECT create_share_link('ranking','10','두 번째',3);\"" > /dev/null 2>&1
THIRD=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"
    SET ROLE authenticated; SET request.jwt.claim.sub = '$FRIEND';
    SELECT create_share_link('ranking','10','세 번째',3);\"" 2>&1)
check "🚨 회원은 3개째를 못 만든다" "yes" \
  "$(if echo "$THIRD" | grep -q "2 개까지"; then echo yes; else echo "no($THIRD)"; fi)"

# ⚠️ WHERE 안에서 함수를 부르면 줄마다 새 링크가 만들어집니다.
#    먼저 만들고, 그 다음에 확인해야 합니다.
BTOKEN=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '$BOSS';
    SELECT create_share_link('ranking','10','대표님 무기한',NULL);\"" 2>&1 | tail -1 | tr -d '[:space:]')
check "대표님은 기한 없이도 만들 수 있다" "1" \
  "$(ask "SELECT count(*) FROM public_links
          WHERE token = '$BTOKEN' AND expires_at IS NULL;")"

# ⚠️ 읽기가 막히면 오류가 아니라 **0줄**이 돌아옵니다.
#    try() 는 오류만 보므로 여기서는 줄 수를 직접 셉니다.
check "🚨 표 자체는 여전히 잠겨 있다 (회원이 주소값을 못 읽음)" "0" \
  "$(ask "SET ROLE authenticated; SET request.jwt.claim.sub = '$FRIEND';
          SELECT count(*) FROM public_links;")"

check "로그인 안 한 사람은 여전히 못 만든다" "blocked" \
  "$(try_anon "SELECT create_share_link('ranking','10','몰래',30);")"

echo ""
echo "[6] 수집 작업(service_role)은 계속 돌아야 한다"
check "관리자 열쇠는 순위를 쓸 수 있다" "ok" \
  "$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"SET ROLE service_role; UPDATE store_books SET raw_title='수집갱신' WHERE id=1;\"" >/dev/null 2>&1 && echo ok || echo blocked)"

echo ""
echo "=================================================================="
if [ "$FAILED" -gt 0 ]; then
  echo "  ❌ 실패 $FAILED 건 — 보안 규칙이 의도대로 막지 않습니다."
  exit 1
fi
echo "  ✅ 전부 통과"
