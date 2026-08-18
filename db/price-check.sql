-- ===========================================================================
--  정가 조사 — 74% 가 정상인지 아닌지 가려냅니다
-- ===========================================================================
--
--  【2026-08-18 대표님 지시】 "정가 점검 조사해줘."
--
--  【1차 조사에서 답이 나왔습니다 — 74% 는 정상입니다】
--      ③ 넷이 같은 무리 12,211개 중 정가만 달라 갈라진 것 94개 (0.8%)
--  비교 후보 대부분이 진짜 다른 책이었고, 다른 책이라 정가도 달랐던
--  것입니다. 어느 서점이 가격을 잘못 읽고 있는 상황이 아닙니다.
--
--  🚨 【1차 조사의 ①② 는 쓸모가 없었습니다 — 제 설계 잘못입니다】
--  ① 은 '이미 한 책으로 묶인 묶음 중 정가가 갈린 것' 을 셌습니다.
--  그런데 매칭 규칙이 **정가가 다르면 아예 안 묶습니다**(match.py 의
--  price_hard). 그러니 ① 은 **구조상 언제나 0** 입니다. 0.0% 가 나온 것은
--  건강해서가 아니라 그렇게밖에 나올 수 없어서입니다.
--
--  매칭 로그의 ✅ 세 줄(같은 서점끼리 0.0%)을 두고 "건강 신호가 아니다"
--  라고 지적해 놓고, 제가 같은 모양의 숫자를 만들었습니다.
--
--  그래서 ①② 는 **규칙이 제대로 도는지 보는 자리**로 뜻을 바꿨습니다.
--  0 이 아니면 price_hard 규칙이 새고 있다는 뜻입니다. 그것대로 쓸모가
--  있지만, '정가를 잘 읽고 있는가' 와는 상관이 없습니다.
--
--  【이 판은 무엇이 다른가요?】
--  진짜 봐야 할 **그 94개**를 눈으로 보여 줍니다.
--    ③ 몇 개인지 (1차와 같음)
--    ④ 그 94개가 실제로 어떤 책인지 — 제목·출판사·서점별 정가
--    ⑤ 그중 어느 서점이 '혼자 다른 값' 인지
--
--  ⚠️ 【아무것도 바꾸지 않습니다】 세기만 합니다.
--
--  실행: Supabase → SQL Editor → New query → 전체 붙여넣고 Run
--        표 하나가 나옵니다. 그대로 저에게 보내 주세요. (10~40초)
-- ===========================================================================

WITH
priced AS (
    SELECT sb.id, sb.book_id, sb.store_id, sb.list_price
      FROM store_books sb
     WHERE sb.list_price IS NOT NULL
),

-- ---------------------------------------------------------------------------
--  ①② 규칙이 새지 않는지 — 0 이 나와야 정상입니다
-- ---------------------------------------------------------------------------
--  ⚠️ 이건 '정가를 잘 읽고 있는가' 를 재는 것이 아닙니다.
--     매칭이 '정가가 다르면 안 묶는다' 는 규칙을 지키고 있는지만 봅니다.
--     사람이 손으로 붙인 묶음(강제로 묶기)은 그 규칙을 건너뛰므로,
--     여기 걸리면 그건 대표님이 일부러 하신 것일 수 있습니다.
-- ---------------------------------------------------------------------------
per_book AS (
    SELECT book_id,
           count(*)                   AS n_row,
           count(DISTINCT list_price) AS n_price
      FROM priced
     WHERE book_id IS NOT NULL
     GROUP BY book_id
),
multi AS (SELECT * FROM per_book WHERE n_row > 1),
split AS (SELECT * FROM multi WHERE n_price > 1),

-- ---------------------------------------------------------------------------
--  ③ 제목·저자·출판사·출간월이 전부 같은 무리 — 정가가 갈렸는가
-- ---------------------------------------------------------------------------
--  🚨 여기가 진짜 답입니다. 매칭이 어떻게 판단했는지와 **상관없이**
--     원본 자료만 보고 셉니다. 넷이 전부 같으면 사실상 같은 책인데,
--     정가가 갈렸다면 그 정가 중 하나가 틀렸을 가능성이 큽니다.
-- ---------------------------------------------------------------------------
key4 AS (
    -- ⚠️ priced 와 store_books 를 이어 붙이면 store_id·list_price 가 양쪽에
    --    다 있어 "ambiguous" 오류가 납니다 (2026-08-18 실제로 겪음).
    --    priced 는 store_books 를 거른 것뿐이므로 하나만 봅니다.
    SELECT sb.norm_title, sb.norm_author, sb.norm_publisher, sb.pub_ym,
           count(DISTINCT sb.store_id)   AS n_store,
           count(DISTINCT sb.list_price) AS n_price
      FROM store_books sb
     WHERE sb.list_price IS NOT NULL
       AND sb.norm_title IS NOT NULL AND sb.norm_title <> ''
       AND sb.norm_author IS NOT NULL AND sb.norm_author <> ''
       AND sb.norm_publisher IS NOT NULL AND sb.norm_publisher <> ''
       AND sb.pub_ym IS NOT NULL
     GROUP BY 1, 2, 3, 4
),
cross_store AS (SELECT * FROM key4 WHERE n_store > 1),

-- 정가만 달라서 갈라진 무리 (1차 조사에서 94개였던 그것)
odd_group AS (
    SELECT norm_title, norm_author, norm_publisher, pub_ym
      FROM cross_store WHERE n_price > 1
),
odd_rows AS (
    SELECT sb.norm_title, sb.norm_author, sb.norm_publisher, sb.pub_ym,
           sb.store_id, sb.list_price, sb.raw_title, sb.raw_publisher
      FROM store_books sb
      JOIN odd_group g
        ON g.norm_title     = sb.norm_title
       AND g.norm_author    = sb.norm_author
       AND g.norm_publisher = sb.norm_publisher
       AND g.pub_ym         = sb.pub_ym
     WHERE sb.list_price IS NOT NULL
),

-- ---------------------------------------------------------------------------
--  ④ 그 무리들이 실제로 어떤 책인지
-- ---------------------------------------------------------------------------
-- ⚠️ string_agg 에 DISTINCT 를 쓰면 정렬 기준을 글자로만 잡을 수 있어서
--    '교보 · 알라딘 · 예스24' 처럼 가나다순으로 섞입니다. 사이트는
--    교보 → 예스24 → 알라딘 순으로 보여주므로 순서를 맞춥니다.
--    그래서 겹치는 줄을 **먼저** 걸러 두고, 그다음에 서점 번호로 줄 세웁니다.
odd_pairs AS (
    SELECT DISTINCT norm_title, norm_author, norm_publisher, pub_ym,
           store_id, list_price
      FROM odd_rows
),
odd_label AS (
    SELECT norm_title, norm_author, norm_publisher, pub_ym,
           string_agg(
               CASE store_id WHEN 1 THEN '교보' WHEN 2 THEN '예스24'
                             WHEN 3 THEN '알라딘' ELSE store_id::text END
               || ' ' || to_char(list_price, 'FM999,999,999') || '원',
               ' · ' ORDER BY store_id, list_price
           ) AS prices,
           max(list_price) - min(list_price) AS gap
      FROM odd_pairs
     GROUP BY 1, 2, 3, 4
),
odd_name AS (
    SELECT norm_title, norm_author, norm_publisher, pub_ym,
           min(raw_title)     AS title,
           min(raw_publisher) AS publisher
      FROM odd_rows
     GROUP BY 1, 2, 3, 4
),
detail AS (
    SELECT n.title, n.publisher, l.prices, l.gap
      FROM odd_label l
      JOIN odd_name n
        USING (norm_title, norm_author, norm_publisher, pub_ym)
     ORDER BY l.gap DESC
     LIMIT 25
),

-- ---------------------------------------------------------------------------
--  ⑤ 그 무리들에서 어느 서점이 '혼자 다른 값' 인가
-- ---------------------------------------------------------------------------
--  🚨 과반이 있는 무리만 봅니다. 1:1 로 갈리면 누가 틀렸는지 알 수
--     없는데, 억지로 한쪽에 씌우면 엉뚱한 서점을 범인으로 만듭니다.
-- ---------------------------------------------------------------------------
g_votes AS (
    SELECT norm_title, norm_author, norm_publisher, pub_ym,
           list_price, count(*) AS n
      FROM odd_rows
     GROUP BY 1, 2, 3, 4, 5
),
g_total AS (
    SELECT norm_title, norm_author, norm_publisher, pub_ym, sum(n) AS total
      FROM g_votes GROUP BY 1, 2, 3, 4
),
g_major AS (
    SELECT v.norm_title, v.norm_author, v.norm_publisher, v.pub_ym,
           v.list_price AS major_price
      FROM g_votes v
      JOIN g_total t
        ON t.norm_title     = v.norm_title
       AND t.norm_author    = v.norm_author
       AND t.norm_publisher = v.norm_publisher
       AND t.pub_ym         = v.pub_ym
     WHERE v.n * 2 > t.total
),
g_odd AS (
    SELECT r.store_id
      FROM odd_rows r
      JOIN g_major m
        ON m.norm_title     = r.norm_title
       AND m.norm_author    = r.norm_author
       AND m.norm_publisher = r.norm_publisher
       AND m.pub_ym         = r.pub_ym
     WHERE r.list_price <> m.major_price
),
g_tie AS (
    SELECT o.norm_title FROM odd_group o
     WHERE NOT EXISTS (
        SELECT 1 FROM g_major m
         WHERE m.norm_title     = o.norm_title
           AND m.norm_author    = o.norm_author
           AND m.norm_publisher = o.norm_publisher
           AND m.pub_ym         = o.pub_ym)
)

-- ---------------------------------------------------------------------------
--  결과 — Supabase 화면은 마지막 표 하나만 보여주므로 전부 합칩니다
-- ---------------------------------------------------------------------------
SELECT "구분", "항목", "값", "참고" FROM (

    -- ── ① 규칙이 새지 않는지 (정가 품질과는 무관) ─────────────────
    SELECT 11 AS ord, '① 규칙 점검' AS "구분",
           '2개 서점 이상에서 정가를 아는 묶음' AS "항목",
           to_char((SELECT count(*) FROM multi), 'FM999,999,999') AS "값",
           '' AS "참고"
    UNION ALL
    SELECT 12, '① 규칙 점검', '그중 정가가 갈린 묶음',
           to_char((SELECT count(*) FROM split), 'FM999,999,999'),
           '⚠️ 0 이 정상입니다. 매칭이 정가가 다르면 아예 안 묶기 때문에 '
           || '구조상 0 입니다. 0 이 아니면 규칙이 새거나 손으로 붙이신 것입니다'

    -- ── ③ 진짜 답 ────────────────────────────────────────────────
    UNION ALL
    SELECT 31, '③ 넷이 같은 무리', '제목·저자·출판사·출간월이 전부 같은 무리',
           to_char((SELECT count(*) FROM cross_store), 'FM999,999,999'),
           '2개 서점 이상에 걸쳐 있는 것만'
    UNION ALL
    SELECT 32, '③ 넷이 같은 무리', '🚨 그중 정가만 달라서 갈라진 무리',
           to_char((SELECT count(*) FROM odd_group), 'FM999,999,999'),
           '넷이 전부 같으면 사실상 같은 책입니다'
    UNION ALL
    SELECT 33, '③ 넷이 같은 무리', '🚨 그 비율',
           CASE WHEN (SELECT count(*) FROM cross_store) = 0 THEN '—'
                ELSE to_char(100.0 * (SELECT count(*) FROM odd_group)
                             / (SELECT count(*) FROM cross_store), 'FM990.00') || '%'
           END,
           '낮으면(5% 이하) 매칭 로그의 74% 는 그냥 다른 책이라 정상입니다'

    -- ── ⑤ 누가 튀나 ─────────────────────────────────────────────
    UNION ALL
    SELECT 51, '⑤ 누가 튀나', '교보문고',
           to_char((SELECT count(*) FROM g_odd WHERE store_id = 1),
                   'FM999,999,999') || '번',
           '과반이 있는 무리에서 혼자 다른 값이던 횟수'
    UNION ALL
    SELECT 52, '⑤ 누가 튀나', '예스24',
           to_char((SELECT count(*) FROM g_odd WHERE store_id = 2),
                   'FM999,999,999') || '번', ''
    UNION ALL
    SELECT 53, '⑤ 누가 튀나', '알라딘',
           to_char((SELECT count(*) FROM g_odd WHERE store_id = 3),
                   'FM999,999,999') || '번', ''
    UNION ALL
    SELECT 54, '⑤ 누가 튀나', '누가 틀렸는지 알 수 없는 무리',
           to_char((SELECT count(*) FROM g_tie), 'FM999,999,999'),
           '두 값이 1:1 로 갈린 경우입니다 (판단 보류)'

    -- ── ④ 실제로 어떤 책인지 ────────────────────────────────────
    UNION ALL
    SELECT 60 + row_number() OVER (ORDER BY gap DESC), '④ 실제 사례',
           left(title, 36) || '  /  ' || coalesce(left(publisher, 14), ''),
           to_char(gap, 'FM999,999,999') || '원 차이',
           prices
      FROM detail

) x ORDER BY ord;
