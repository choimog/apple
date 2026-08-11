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
cp "$ROOT/db/schema.sql" "$ROOT/db/size-check.sql" "$ROOT/db/price-add.sql" \
   "$ROOT/db/space-where.sql" "$ROOT/db/space-growth.sql" \
   "$ROOT/db/space-why.sql" "$ROOT/db/space-free.sql" "$ROOT/db/space-trim.sql" "$ROOT/db/decision-check.sql" \
   "$ROOT/db/auth.sql" "$DATA/"
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
echo "=== [다] db/space-where.sql — 용량이 어디로 갔나 (2026-08-11) ==="
# 오늘 [용량 확인] 이 '1년 뒤 528MB · 10일 뒤 한도' 라고 알려 왔습니다.
# 어디를 줄일지 정하려면 먼저 재야 하는데, 재는 파일이 실행하자마자
# 죽으면 아무것도 못 알아냅니다. 자료가 하나도 없을 때부터 봅니다.
# 매칭 판정 줄이 있어야 ③ 이 나옵니다
cat > "$DATA/seedm.sql" <<'SQL'
INSERT INTO book_matches(store_book_a, store_book_b, score, reasons, decision)
  VALUES (1, 2, 90, '{"title_sim":0.94}', 'auto_high');
SQL
chmod 644 "$DATA/seedm.sql"; q seedm.sql >/dev/null

OUT3=$(q space-where.sql)
echo "$OUT3" | grep -qi "ERROR" && { echo "$OUT3" | grep -i error; say 0 "죽지 않는다"; } \
  || say 1 "죽지 않는다"
echo "$OUT3" | grep -q "division by zero" && say 0 "0으로 안 나눈다" || say 1 "0으로 안 나눈다"

# 🚨 가장 중요한 시험 — **표가 딱 하나**여야 합니다.
#    2026-08-11 에 이것 때문에 대표님 시간을 버렸습니다. 표를 네 개로
#    나눠 드리고 "스크롤하면 이어서 나옵니다" 라고 안내했는데,
#    Supabase SQL Editor 는 **맨 마지막 표 하나만** 보여줍니다.
#    그래서 대표님께는 ④ 만 보였고, 나머지 세 개는 영영 못 보셨습니다.
ROWS=$(echo "$OUT3" | grep -c "row)\|rows)")
[ "$ROWS" = 1 ] && say 1 "표가 딱 하나로 나온다 (스크롤 필요 없음)" \
  || say 0 "표가 딱 하나로 나온다 (스크롤 필요 없음)" "$ROWS"

# 그 하나의 표 안에 세 가지가 다 들어 있어야 합니다
echo "$OUT3" | grep -q "① 색인(목차)" && say 1 "① 색인별 크기가 들어 있다" \
  || say 0 "① 색인별 크기가 들어 있다"
echo "$OUT3" | grep -q "② 표 전체" && say 1 "② 자료/색인 비중이 들어 있다" \
  || say 0 "② 자료/색인 비중이 들어 있다"
echo "$OUT3" | grep -q "③ 매칭 판정" && say 1 "③ 판정별 줄 수가 들어 있다" \
  || say 0 "③ 판정별 줄 수가 들어 있다"

# 지워도 되는 목차를 실제로 짚어 주는지 (이게 자료를 안 잃고 줄이는 유일한 길)
echo "$OUT3" | grep -qE "한 번도 안 씀|읽힌 횟수" \
  && say 1 "안 쓰는 목차를 짚어 준다" || say 0 "안 쓰는 목차를 짚어 준다"
echo "$OUT3" | grep -q "기본키 — 못 지웁니다" \
  && say 1 "못 지우는 것을 못 지운다고 말한다" || say 0 "못 지우는 것을 못 지운다고 말한다"
echo "$OUT3" | grep -q "auto_high" && say 1 "판정 이름이 실제로 나온다" \
  || say 0 "판정 이름이 실제로 나온다"

echo
echo "=== [라] db/space-growth.sql — 날짜별 증가 속도 (2026-08-11) ==="
# 🚨 앞의 ④ 는 '최근 7일' 을 뭉쳐서 나눴다가, 첫 수집일에 몰린 몇 만 권
#    때문에 하루 19,101권이라는 헛된 값을 냈습니다. 이 파일은 그걸
#    날짜별로 갈라서 봅니다. **첫날을 빼고** 세는지가 핵심입니다.
OUT4=$(q space-growth.sql)
echo "$OUT4" | grep -qi "ERROR" && { echo "$OUT4" | grep -i error; say 0 "죽지 않는다"; } \
  || say 1 "죽지 않는다"
echo "$OUT4" | grep -q "division by zero" && say 0 "0으로 안 나눈다" || say 1 "0으로 안 나눈다"
# 🚨 여기도 표가 딱 하나여야 합니다 (Supabase 는 마지막 표만 보여줍니다)
R4=$(echo "$OUT4" | grep -c "row)\|rows)")
[ "$R4" = 1 ] && say 1 "표가 딱 하나로 나온다" || say 0 "표가 딱 하나로 나온다" "$R4"
echo "$OUT4" | grep -q "새로 생긴 줄" && say 1 "① 날짜별 줄이 들어 있다" \
  || say 0 "① 날짜별 줄이 들어 있다"
echo "$OUT4" | grep -q "② 정리" && say 1 "② 정리가 들어 있다" || say 0 "② 정리가 들어 있다"
echo "$OUT4" | grep -q "첫 수집일. 이 줄은 빼고 보세요" \
  && say 1 "첫 수집일을 표시해 준다" || say 0 "첫 수집일을 표시해 준다"

# 🚨 하루치밖에 없으면 '판정 불가' 여야 합니다.
#    여기서 숫자를 지어내면 또 틀린 예측을 하게 됩니다.
#    (seed 의 store_books 2줄은 둘 다 오늘 = 첫 수집일 하나뿐)
echo "$OUT4" | grep -q "판정 불가" && say 1 "하루뿐이면 판정 불가라고 말한다" \
  || say 0 "하루뿐이면 판정 불가라고 말한다"
echo "$OUT4" | grep -qE '1년 뒤 도서 목록 예상.*\| *[0-9]+ [kMG]B' \
  && say 0 "하루뿐인데 1년치를 지어내지 않는다" \
  || say 1 "하루뿐인데 1년치를 지어내지 않는다"

# 이틀치가 있으면 첫날을 뺀 평균을 실제로 낸다
cat > "$DATA/seed2.sql" <<'SQL'
INSERT INTO store_books(id, store_id, store_book_key, raw_title, first_seen_at)
  VALUES (3,1,'k3','다', now() - interval '1 day'),
         (4,1,'k4','라', now() - interval '1 day'),
         (5,2,'k5','마', now() - interval '1 day');
SQL
chmod 644 "$DATA/seed2.sql"; q seed2.sql >/dev/null
OUT5=$(q space-growth.sql)
echo "$OUT5"
# 어제 3줄(첫날) · 오늘 2줄 → 첫날을 뺀 평균은 2 여야 합니다
echo "$OUT5" | grep -A1 "그 뒤 하루 평균 새 줄" | grep -qE '\| 2 +\|' \
  && say 1 "첫 수집일을 빼고 평균을 낸다" || say 0 "첫 수집일을 빼고 평균을 낸다"

echo
echo "=== [마] db/space-why.sql — 왜 하루 2만 줄씩 늘어나는가 (2026-08-11) ==="
# 하루 2만 줄이 (가) 진짜 새 책인지 (나) 같은 책이 다시 등록되는 고장인지
# 가려내는 파일입니다. 어느 쪽이냐에 따라 대책이 정반대라, 이 파일이
# 죽거나 숫자를 지어내면 정반대 방향으로 일하게 됩니다.
OUT6=$(q space-why.sql)
echo "$OUT6" | grep -qi "ERROR" && { echo "$OUT6" | grep -i error; say 0 "죽지 않는다"; } \
  || say 1 "죽지 않는다"
echo "$OUT6" | grep -q "division by zero" && say 0 "0으로 안 나눈다" || say 1 "0으로 안 나눈다"
R6=$(echo "$OUT6" | grep -c "row)\|rows)")
[ "$R6" = 1 ] && say 1 "표가 딱 하나로 나온다" || say 0 "표가 딱 하나로 나온다" "$R6"
echo "$OUT6" | grep -q "그중 이미 있던 책" && say 1 "🚨 갈림길 줄이 나온다" \
  || say 0 "🚨 갈림길 줄이 나온다"
echo "$OUT6" | grep -q "같은 서점에 두 줄 이상인 책" && say 1 "중복 줄을 센다" \
  || say 0 "중복 줄을 센다"
echo "$OUT6" | grep -q "301위 이하" && say 1 "뒤쪽 순위 비중이 나온다" \
  || say 0 "뒤쪽 순위 비중이 나온다"
echo "$OUT6" | grep -q "아무도 안 읽는 book_meta" && say 1 "book_meta 크기가 나온다" \
  || say 0 "book_meta 크기가 나온다"

# 🚨 진짜로 중복을 잡아내는지 확인합니다. 같은 서점(1)에 같은 제목·저자를
#    두 줄 넣어 두고, 4번이 1 이상으로 나와야 합니다. 0 이 나오면
#    '고장이 아니다' 라는 틀린 결론을 내고 엉뚱한 대책을 세우게 됩니다.
cat > "$DATA/seedd.sql" <<'SQL'
UPDATE store_books SET norm_title = '같은책', norm_author = '같은저자'
 WHERE id IN (1, 3);
SQL
chmod 644 "$DATA/seedd.sql"; q seedd.sql >/dev/null
OUT7=$(q space-why.sql)
echo "$OUT7"
echo "$OUT7" | grep -A1 "같은 서점에 두 줄 이상인 책" | grep -qE '\| 1 +\|' \
  && say 1 "중복을 실제로 잡아낸다" || say 0 "중복을 실제로 잡아낸다"

echo
echo "=== [바] db/space-free.sql — 자료를 안 잃고 되찾기 (2026-08-11) ==="
# 이 파일은 **지우는** 파일입니다. 진단이 아니라 실제로 자료를 건드립니다.
# 그래서 더더욱 진짜 PostgreSQL 로 돌려 봐야 합니다. 중간에 죽으면
# 절반만 지워진 채로 남고, 대표님은 무엇이 지워졌는지 알 수 없습니다.
OUT8=$(q space-free.sql)
echo "$OUT8" | grep -qi "ERROR" && { echo "$OUT8" | grep -i error; say 0 "죽지 않는다"; } \
  || say 1 "죽지 않는다"
echo "$OUT8"
echo "$OUT8" | grep -q "0줄이면 성공" && say 1 "확인표가 나온다" || say 0 "확인표가 나온다"
echo "$OUT8" | grep -q "✅ 지웠습니다" && say 1 "안 쓰던 목차를 실제로 지운다" \
  || say 0 "안 쓰던 목차를 실제로 지운다"

# 🚨 지우면 안 되는 것은 그대로 있어야 합니다.
#    한 줄 잘못 쓰면 대표님이 손으로 하신 8만 건의 검토가 사라집니다.
for t in store_books books rankings book_matches; do
  N=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"SELECT count(*) FROM $t\"" 2>&1)
  case "$t" in
    store_books|rankings|book_matches) [ "$N" -gt 0 ] 2>/dev/null \
      && say 1 "$t 은 그대로 있다 ($N줄)" || say 0 "$t 이 비었다" ;;
    *) say 1 "$t 확인" ;;
  esac
done

# 두 번 실행해도 안전해야 합니다 (대표님이 실수로 또 누르실 수 있습니다)
OUT9=$(q space-free.sql)
echo "$OUT9" | grep -qi "ERROR" && say 0 "두 번 실행해도 안전하다" \
  || say 1 "두 번 실행해도 안전하다"

echo
echo "=== [사] 🚨 Supabase 에서 못 도는 문장이 섞여 있지 않은가 ==="
# Supabase SQL Editor 는 붙여넣은 것을 **한 덩어리(트랜잭션)** 로 돌립니다.
# VACUUM 은 그 안에서 못 돌고, 죽으면서 앞의 지우기까지 통째로 되돌립니다.
# 그런데 제 컴퓨터의 psql 은 통과시키기 때문에 위 시험들은 속습니다.
# 그래서 글자로 직접 막습니다.
for f in space-where space-growth space-why space-free space-trim decision-check; do
  if grep -qiE '^[[:space:]]*(VACUUM|REINDEX CONCURRENTLY|CREATE INDEX CONCURRENTLY)' \
       "$ROOT/db/$f.sql"; then
    say 0 "db/$f.sql 에 Supabase 에서 못 도는 문장이 있다"
  else
    say 1 "db/$f.sql — Supabase 에서 돌 수 있다"
  fi
done

echo
echo "=== [아] db/space-trim.sql — 기준 밖 순위 정리 (2026-08-11 대표님 결정) ==="
# 일간 300위 · 주간 500위. 이 파일은 **되돌릴 수 없게 지웁니다.**
# 가장 무서운 것은 대표님이 손으로 하신 8만 5천 건의 결정입니다.
# store_books 를 지우면 데이터베이스가 그 결정까지 함께 지웁니다(CASCADE).
cat > "$DATA/seedt.sql" <<'SQL'
INSERT INTO categories(id, store_id, code, name, kind, url_template) VALUES
  (2, 2, 'w1', '주간전체', 'weekly', 'http://x/{page}');
-- 기준 안: 일간 1위 / 주간 400위      → 남아야 함
-- 기준 밖: 일간 301위 / 주간 501위    → 지워져야 함
INSERT INTO store_books(id, store_id, store_book_key, raw_title) VALUES
  (10,1,'t10','안'), (11,1,'t11','밖'), (12,2,'t12','주간안'), (13,2,'t13','주간밖'),
  (14,1,'t14','결정걸린책');
INSERT INTO rankings(snapshot_date, category_id, rank, store_book_id) VALUES
  ('2026-08-11',1,  1,10), ('2026-08-11',1,301,11),
  ('2026-08-11',2,400,12), ('2026-08-11',2,501,13);
-- 🚨 14번 책은 순위가 하나도 없지만 대표님 결정이 걸려 있습니다.
INSERT INTO book_matches(store_book_a, store_book_b, score, reasons, decision)
  VALUES (12, 14, 90, '{}', 'manual_merge');
SQL
chmod 644 "$DATA/seedt.sql"; q seedt.sql >/dev/null
BEFORE=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"SELECT count(*) FROM book_matches WHERE decision LIKE 'manual%'\"" 2>&1)

OUTT=$(q space-trim.sql)
echo "$OUTT" | grep -qi "ERROR" && { echo "$OUTT" | grep -i error; say 0 "죽지 않는다"; } \
  || say 1 "죽지 않는다"
echo "$OUTT"

R=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"SELECT string_agg(store_book_id::text,',' ORDER BY store_book_id) FROM rankings\"" 2>&1)
[ "$R" = "1,1,2,10,12" ] && say 1 "기준 밖 순위만 지운다 (남은 것: $R)" \
  || say 0 "기준 밖 순위만 지운다" "$R"

# 🚨 가장 중요 — 대표님 결정이 하나도 안 줄어야 합니다
AFTER=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"SELECT count(*) FROM book_matches WHERE decision LIKE 'manual%'\"" 2>&1)
[ "$BEFORE" = "$AFTER" ] && say 1 "🚨 대표님 결정이 그대로다 ($BEFORE건)" \
  || say 0 "🚨 대표님 결정이 사라졌다 ($BEFORE → $AFTER)"

# 결정이 걸린 상품(14번)은 순위가 없어도 남아야 합니다
K=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"SELECT count(*) FROM store_books WHERE id=14\"" 2>&1)
[ "$K" = "1" ] && say 1 "결정이 걸린 상품은 순위가 없어도 남긴다" \
  || say 0 "결정이 걸린 상품을 지웠다"

# 순위도 결정도 없는 상품(11,13)은 지워져야 합니다
G=$(run "psql -h $SOCK -p $PORT -U postgres -tAc \"SELECT count(*) FROM store_books WHERE id IN (11,13)\"" 2>&1)
[ "$G" = "0" ] && say 1 "쓸모없어진 상품은 지운다" || say 0 "쓸모없어진 상품이 남았다" "$G"

echo
echo "=== [자] db/decision-check.sql — 결정 8만 5천 건의 출처 (2026-08-11) ==="
# 대표님: "나는 결정한 건이 없어. 전부 다 되돌려놓은 상태야."
# 그런데 DB 에는 manual 85,215줄. 둘 중 하나가 사실이 아닙니다.
# 이 파일이 답을 냅니다. 죽으면 답을 못 얻습니다.
cat > "$DATA/seedc.sql" <<'SQL'
ALTER TABLE book_matches ADD COLUMN IF NOT EXISTS auto_decision text;
-- 되돌릴 수 있는 것 1건 (auto_decision 있음)
UPDATE book_matches SET decision='manual_merge', auto_decision='auto_low',
       decided_by=NULL, decided_at=now() WHERE id=(SELECT min(id) FROM book_matches);
-- 되돌릴 수 없는 것 1건 (auto_decision 이 비어 있음) ← 대표님 상황 재현
INSERT INTO book_matches(store_book_a, store_book_b, score, reasons, decision,
                         auto_decision, decided_at)
  VALUES (10, 11, 70, '{}', 'manual_split', NULL, now());
SQL
chmod 644 "$DATA/seedc.sql"; q seedc.sql >/dev/null
OUTC=$(q decision-check.sql)
echo "$OUTC" | grep -qi "ERROR" && { echo "$OUTC" | grep -i error; say 0 "죽지 않는다"; } \
  || say 1 "죽지 않는다"
echo "$OUTC"
RC=$(echo "$OUTC" | grep -c "row)\|rows)")
[ "$RC" = 1 ] && say 1 "표가 딱 하나로 나온다" || say 0 "표가 딱 하나로 나온다" "$RC"

# 🚨 핵심 — 되돌릴 수 없는 결정을 실제로 세어내는지.
#    0 이 나오면 원인을 못 찾고 엉뚱한 데를 파게 됩니다.
echo "$OUTC" | grep -A1 "★ 되돌릴 수 없는 결정" | grep -qE '\| 1 +\|' \
  && say 1 "🚨 되돌릴 수 없는 결정을 세어낸다" || say 0 "🚨 되돌릴 수 없는 결정을 세어낸다"
echo "$OUTC" | grep -A1 "되돌릴 수 있는 결정" | grep -qE '\| 1 +\|' \
  && say 1 "되돌릴 수 있는 것과 구분한다" || say 0 "되돌릴 수 있는 것과 구분한다"
echo "$OUTC" | grep -q "누른 사람이 비어 있는 것" && say 1 "누른 사람 유무를 본다" \
  || say 0 "누른 사람 유무를 본다"

# 🚨 db/auth.sql 의 채워넣기가 manual 을 건너뛰는 것이 이 문제의 원인입니다.
#    누가 이 조건을 '고쳐서' manual 까지 채우면, 되돌리기가 manual 을
#    manual 로 되돌리게 되어 영영 안 풀립니다. 조건을 못박아 둡니다.
grep -q "AND decision IN ('auto_high', 'auto_low', 'rejected')" "$ROOT/db/auth.sql" \
  && say 1 "auth.sql 이 사람 결정을 원래 판단으로 덮지 않는다" \
  || say 0 "auth.sql 의 채워넣기 조건이 바뀌었다"

echo
[ "$bad" = 0 ] && echo "✅ 모두 통과" || { echo "❌ 실패"; exit 1; }
