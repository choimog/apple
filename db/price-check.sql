-- ===========================================================================
--  정가 조사 — 74% 가 정상인지 아닌지 가려냅니다
-- ===========================================================================
--
--  【2026-08-18 대표님 지시】 "정가 점검 조사해줘."
--
--  【무엇이 걸렸나요?】
--  매칭이 끝날 때마다 이 표가 찍힙니다.
--
--      ✅ 교보↔교보:      0 /  98,471쌍 ( 0.0%)
--      🚨 교보↔예스24: 106,205 / 141,876쌍 (74.9%)
--      🚨 교보↔알라딘: 123,969 / 165,821쌍 (74.8%)
--      ✅ 예스24↔예스24:  0 / 114,015쌍 ( 0.0%)
--      🚨 예스24↔알라딘:147,697 / 199,606쌍 (74.0%)
--      ✅ 알라딘↔알라딘:  0 / 119,519쌍 ( 0.0%)
--
--  저 표만으로는 **정상인지 아닌지 알 수 없습니다.** 두 가지 이유입니다.
--
--    ① ✅ 세 줄은 건강 신호가 아닙니다. 같은 서점 상품끼리는 가격을 보기
--       **전에** 이미 '같은 서점' 이라는 이유로 갈라집니다. 그래서 구조상
--       언제나 0.0% 입니다. 멀쩡해 보이지만 아무 뜻이 없습니다.
--
--    ② 🚨 세 줄의 74% 는 '비교해 본 짝' 기준입니다. 비교 후보 대부분은
--       원래 **다른 책**이고, 다른 책은 정가가 다른 게 당연합니다.
--       74% 안에 진짜 문제가 얼마나 섞였는지는 저 표로는 못 봅니다.
--
--  【그래서 이 파일은 무엇을 보나요?】
--  '다른 책이라 정가가 다른 것' 을 걷어내고, **정가가 같아야만 하는 짝**만
--  골라 봅니다. 도서정가제상 정가는 출판사가 정한 하나의 값이라,
--  같은 책이면 3사가 같아야 정상입니다.
--
--    ① 이미 한 책으로 묶인 묶음 중 정가가 갈린 것  ← 가장 확실한 신호
--    ② 그중 어느 서점이 '혼자 다른 값' 인가          ← 범인 찾기
--    ③ 제목·저자·출판사·출간월이 전부 같은데 정가만 달라 갈라진 짝
--    ④ 실제 사례를 눈으로
--
--  ⚠️ 【아무것도 바꾸지 않습니다】 세기만 합니다.
--     만들지도, 고치지도, 지우지도 않습니다.
--
--  실행: Supabase → SQL Editor → New query → 전체 붙여넣고 Run
--        표 하나가 나옵니다. 그대로 저에게 보내 주세요. (10~40초)
-- ===========================================================================

WITH
-- ---------------------------------------------------------------------------
--  정가를 아는 상품만
-- ---------------------------------------------------------------------------
priced AS (
    SELECT sb.id, sb.book_id, sb.store_id, sb.list_price
      FROM store_books sb
     WHERE sb.list_price IS NOT NULL
),

-- ---------------------------------------------------------------------------
--  ① 이미 한 책으로 묶인 묶음별로, 정가가 몇 가지인가
-- ---------------------------------------------------------------------------
--  같은 책이라고 판정된 것들입니다. 여기서 정가가 갈렸다면
--  **둘 중 하나입니다** — 어느 서점이 잘못 읽었거나, 잘못 묶였거나.
-- ---------------------------------------------------------------------------
per_book AS (
    SELECT book_id,
           count(*)                    AS n_row,
           count(DISTINCT list_price)  AS n_price
      FROM priced
     WHERE book_id IS NOT NULL
     GROUP BY book_id
),
multi AS (SELECT * FROM per_book WHERE n_row > 1),
split AS (SELECT * FROM multi WHERE n_price > 1),

-- ---------------------------------------------------------------------------
--  ② 어느 서점이 '혼자 다른 값' 인가
-- ---------------------------------------------------------------------------
--  🚨 3사가 다 있고 2:1 로 갈린 경우만 봅니다.
--     둘만 있고 1:1 로 갈리면 **누가 틀렸는지 알 수 없습니다.**
--     그걸 억지로 한쪽에 씌우면 엉뚱한 서점을 범인으로 만듭니다.
-- ---------------------------------------------------------------------------
votes AS (
    SELECT p.book_id, p.list_price, count(*) AS n
      FROM priced p
      JOIN split s ON s.book_id = p.book_id
     WHERE p.book_id IS NOT NULL
     GROUP BY p.book_id, p.list_price
),
-- 한 값이 과반인 묶음 (2:1 처럼)
major AS (
    SELECT v.book_id, v.list_price AS major_price
      FROM votes v
      JOIN (SELECT book_id, sum(n) AS total FROM votes GROUP BY book_id) t
        ON t.book_id = v.book_id
     WHERE v.n * 2 > t.total
),
odd_one AS (
    SELECT p.store_id
      FROM priced p
      JOIN major m ON m.book_id = p.book_id
     WHERE p.list_price <> m.major_price
),
tie AS (
    SELECT s.book_id FROM split s
     WHERE NOT EXISTS (SELECT 1 FROM major m WHERE m.book_id = s.book_id)
),

-- ---------------------------------------------------------------------------
--  ③ 제목·저자·출판사·출간월이 전부 같은 무리 — 정가가 갈렸는가
-- ---------------------------------------------------------------------------
--  🚨 이것이 매칭 로그의 74% 가 진짜 문제인지 알려 주는 숫자입니다.
--     넷이 전부 같으면 사실상 같은 책입니다. 그런데도 갈라졌다면
--     정가 때문입니다.
-- ---------------------------------------------------------------------------
key4 AS (
    -- ⚠️ priced 와 store_books 를 이어 붙이면 store_id·list_price 가 양쪽에
    --    다 있어 "ambiguous" 오류가 납니다. priced 는 store_books 를 거른
    --    것뿐이므로 여기서는 store_books 하나만 봅니다.
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

-- ---------------------------------------------------------------------------
--  ④ 실제 사례 — 눈으로 봐야 알 수 있는 것이 있습니다
-- ---------------------------------------------------------------------------
sample AS (
    SELECT b.title,
           b.publisher,
           string_agg(
               CASE p.store_id WHEN 1 THEN '교보' WHEN 2 THEN '예스24'
                               WHEN 3 THEN '알라딘' ELSE p.store_id::text END
               || ' ' || to_char(p.list_price, 'FM999,999,999') || '원',
               ' · ' ORDER BY p.store_id
           ) AS prices,
           max(p.list_price) - min(p.list_price) AS gap
      FROM priced p
      JOIN split s ON s.book_id = p.book_id
      JOIN books b ON b.id = p.book_id
     GROUP BY b.title, b.publisher
     ORDER BY gap DESC
     LIMIT 15
)

-- ---------------------------------------------------------------------------
--  결과 — Supabase 화면은 마지막 표 하나만 보여주므로 전부 합칩니다
-- ---------------------------------------------------------------------------
SELECT "구분", "항목", "값", "참고" FROM (

    -- ── ① 이미 묶인 책 ────────────────────────────────────────────
    SELECT 11 AS ord, '① 이미 묶인 책' AS "구분",
           '정가를 아는 상품' AS "항목",
           to_char((SELECT count(*) FROM priced), 'FM999,999,999') AS "값",
           '' AS "참고"
    UNION ALL
    SELECT 12, '① 이미 묶인 책', '2개 서점 이상에서 정가를 아는 묶음',
           to_char((SELECT count(*) FROM multi), 'FM999,999,999'),
           '이 묶음들이 판단 근거입니다'
    UNION ALL
    SELECT 13, '① 이미 묶인 책', '🚨 그중 정가가 갈린 묶음',
           to_char((SELECT count(*) FROM split), 'FM999,999,999'),
           '도서정가제상 같은 책이면 3사가 같아야 정상입니다'
    UNION ALL
    SELECT 14, '① 이미 묶인 책', '🚨 갈린 비율',
           CASE WHEN (SELECT count(*) FROM multi) = 0 THEN '—'
                ELSE to_char(100.0 * (SELECT count(*) FROM split)
                             / (SELECT count(*) FROM multi), 'FM990.0') || '%'
           END,
           '낮을수록 좋습니다. 2026-08-11 교보 가격이 깨졌을 때가 5% 였습니다'

    -- ── ② 누가 혼자 다른 값인가 ──────────────────────────────────
    UNION ALL
    SELECT 21, '② 누가 튀나', '교보문고',
           to_char((SELECT count(*) FROM odd_one WHERE store_id = 1),
                   'FM999,999,999') || '번',
           '3사 중 2:1 로 갈렸을 때 혼자 다른 값이던 횟수'
    UNION ALL
    SELECT 22, '② 누가 튀나', '예스24',
           to_char((SELECT count(*) FROM odd_one WHERE store_id = 2),
                   'FM999,999,999') || '번', ''
    UNION ALL
    SELECT 23, '② 누가 튀나', '알라딘',
           to_char((SELECT count(*) FROM odd_one WHERE store_id = 3),
                   'FM999,999,999') || '번', ''
    UNION ALL
    SELECT 24, '② 누가 튀나', '누가 틀렸는지 알 수 없는 묶음',
           to_char((SELECT count(*) FROM tie), 'FM999,999,999'),
           '두 서점만 있고 1:1 로 갈린 경우입니다 (판단 보류)'

    -- ── ③ 안 묶인 짝 ────────────────────────────────────────────
    UNION ALL
    SELECT 31, '③ 넷이 같은 무리', '제목·저자·출판사·출간월이 전부 같은 무리',
           to_char((SELECT count(*) FROM cross_store), 'FM999,999,999'),
           '2개 서점 이상에 걸쳐 있는 것만 (이미 묶인 것도 포함)'
    UNION ALL
    SELECT 32, '③ 넷이 같은 무리', '🚨 그중 정가만 달라서 갈라진 무리',
           to_char((SELECT count(*) FROM cross_store WHERE n_price > 1),
                   'FM999,999,999'),
           '넷이 전부 같으면 사실상 같은 책입니다'
    UNION ALL
    SELECT 33, '③ 넷이 같은 무리', '🚨 그 비율',
           CASE WHEN (SELECT count(*) FROM cross_store) = 0 THEN '—'
                ELSE to_char(100.0 * (SELECT count(*) FROM cross_store WHERE n_price > 1)
                             / (SELECT count(*) FROM cross_store), 'FM990.0') || '%'
           END,
           '🚨 여기가 핵심 — 낮으면(약 5% 이하) 74% 는 그냥 다른 책이라 정상, 높으면(30% 이상) 어느 서점 가격을 잘못 읽는 것입니다'

    -- ── ④ 실제 사례 ─────────────────────────────────────────────
    UNION ALL
    SELECT 40 + row_number() OVER (ORDER BY gap DESC), '④ 실제 사례',
           left(title, 34) || '  /  ' || coalesce(left(publisher, 14), ''),
           to_char(gap, 'FM999,999,999') || '원 차이',
           prices
      FROM sample

) x ORDER BY ord;
