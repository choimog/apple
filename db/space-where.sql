-- ===========================================================================
--  용량이 어디로 갔는지 재기 — 표 하나로 다 보여줍니다
-- ===========================================================================
--  【무엇을 하나요?】
--  무료 500MB 중 307MB 를 썼고, 지금 설정대로면 약 10일 뒤 한도에 닿습니다.
--  줄여야 하는데 **어디를 줄일지** 모르는 채로 고치면, 아껴 봐야 몇 MB 인
--  곳을 건드리면서 자료만 잃습니다. 그래서 먼저 잽니다.
--
--  【2026-08-11 고쳤습니다 — 제가 잘못 안내했습니다】
--  처음에는 표를 네 개로 나눠 드리면서 "결과창을 스크롤하면 이어서
--  나옵니다" 라고 말씀드렸는데, **틀린 말이었습니다.**
--  Supabase SQL Editor 는 문장을 여러 개 실행하면 **맨 마지막 표 하나만**
--  보여줍니다. 그래서 대표님께는 ④ 만 보였습니다.
--
--  이제 **표 하나**로 합쳤습니다. 붙여넣고 Run 한 번이면 끝입니다.
--  (④ '늘어나는 속도' 는 db/space-growth.sql 로 옮겼습니다.
--   7일을 뭉쳐 나누던 방식이 틀려서 날짜별로 다시 만들었습니다)
--
--  【무엇을 보게 되나요?】
--    ① 색인(목차) 하나하나의 크기
--       색인은 '빨리 찾기 위한 목차' 입니다. 눈에 안 보이지만 자리를
--       차지합니다. **한 번도 안 쓴 목차를 지우는 것이, 자료를 하나도
--       안 잃고 용량을 줄이는 유일한 방법입니다.**
--    ② 표마다 자료와 색인 중 어느 쪽이 큰가
--    ③ 매칭 판정별 줄 수와 '근거' 가 차지하는 양
--       검토 화면이 근거를 실제로 보여주는 것은 「검토 대기」 뿐입니다.
--
--  【안전한가요?】
--  네. 세기만 합니다. 만들지도, 고치지도, 지우지도 않습니다.
--  큰 표를 훑으므로 20~60초쯤 걸릴 수 있습니다.
--
--  실행: Supabase → SQL Editor → New query → 전체 붙여넣고 Run
--        표 **하나**가 나옵니다. 통째로 알려 주세요.
-- ===========================================================================

WITH
-- ---------------------------------------------------------------------------
--  ① 색인(목차) 하나하나가 몇 MB 인가
-- ---------------------------------------------------------------------------
--  "한 번도 안 씀" 은 만들어 놓고 쓰인 적이 없는 목차입니다.
--  (데이터베이스를 다시 켜면 이 횟수는 0부터 다시 셉니다. 하루쯤 돌린
--   뒤에 본 값이라야 믿을 수 있습니다)
idx AS (
    SELECT
        1                                              AS k,
        '① 색인(목차)'                                  AS "구분",
        s.relname || ' → ' || s.indexrelname            AS "이름",
        pg_relation_size(s.indexrelid)                  AS bytes,
        CASE WHEN i.indisprimary THEN '기본키 — 못 지웁니다'
             WHEN i.indisunique  THEN '중복막이 — 못 지웁니다'
             WHEN s.idx_scan = 0 THEN '🚨 한 번도 안 씀'
             ELSE '읽힌 횟수 ' || to_char(s.idx_scan, 'FM999,999,999')
        END                                             AS "참고"
    FROM pg_stat_user_indexes s
    JOIN pg_index i ON i.indexrelid = s.indexrelid
    WHERE s.schemaname = 'public'
    ORDER BY pg_relation_size(s.indexrelid) DESC
    LIMIT 15
),

-- ---------------------------------------------------------------------------
--  ② 표마다 — 자료가 큰가, 목차가 큰가
-- ---------------------------------------------------------------------------
--  색인 비중이 절반을 넘으면, 자료보다 목차에 자리를 더 쓰고 있다는 뜻입니다.
tbl AS (
    SELECT
        2,
        '② 표 전체',
        c.relname,
        pg_total_relation_size(c.oid),
        '자료 ' || pg_size_pretty(pg_relation_size(c.oid))
        || ' · 색인 ' || pg_size_pretty(pg_indexes_size(c.oid))
        || ' (색인이 '
        || round(100.0 * pg_indexes_size(c.oid)
                 / greatest(pg_total_relation_size(c.oid), 1))::text || '%)'
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC
    LIMIT 8
),

-- ---------------------------------------------------------------------------
--  ③ 매칭 판정별 줄 수 — '근거' 를 다 남겨야 하나
-- ---------------------------------------------------------------------------
--  book_matches 에는 '왜 그렇게 봤는지' 근거가 줄마다 함께 저장됩니다.
--  검토 화면이 근거를 실제로 보여주는 것은 「검토 대기(auto_low)」 뿐입니다.
--  자동병합(auto_high)이 압도적으로 많다면, 그쪽 근거를 안 남기는 것만으로
--  **대표님이 보시는 화면은 하나도 안 바뀌면서** 용량이 줄어듭니다.
--
--  ⚠️ 사람이 내린 결정(manual_merge / manual_split)은 무슨 일이 있어도
--     그대로 둡니다. 그것까지 건드리면 대표님이 하신 검토가 사라집니다.
--  ※ '크기' 칸은 표 전체가 아니라 **근거만** 차지하는 양입니다.
mat AS (
    SELECT
        3,
        '③ 매칭 판정',
        decision,
        (avg(pg_column_size(reasons)) * count(*))::bigint,
        to_char(count(*), 'FM999,999,999') || '줄 ('
        || round(100.0 * count(*) / greatest(sum(count(*)) OVER (), 1), 1)::text
        || '%) · 근거만의 크기'
    FROM book_matches
    GROUP BY decision
)

SELECT "구분", "이름", pg_size_pretty(bytes) AS "크기", "참고"
FROM (
    SELECT * FROM idx
    UNION ALL SELECT * FROM tbl
    UNION ALL SELECT * FROM mat
) x
ORDER BY k, bytes DESC;
