-- ============================================================================
-- 菇菇宅配網 — 可清理項目清單
-- 執行日期：待定
-- 說明：以下 SQL 依風險分級，請依序檢查後再執行。
-- 每個區塊都附有復原腳本，出問題可直接還原。
-- ============================================================================

-- ============================================================================
-- 第一部分：廢棄欄位清理 (低風險)
-- 這些欄位經確認「無任何程式碼讀取或寫入」
-- ============================================================================

-- ---- 1a. 復原用的備份腳本 (先不執行，保留) ----
-- ALTER TABLE public.challenges ADD COLUMN current_players integer DEFAULT 0;
-- COMMENT ON COLUMN public.challenges.current_players IS '當前玩家數（已棄用，人數由 signups count 計算）';
-- 
-- ALTER TABLE public.postcard_likes ADD COLUMN guest_id text;
-- COMMENT ON COLUMN public.postcard_likes.guest_id IS '訪客識別（已棄用，訪客按讚走 guest_postcard_likes 表）';
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_likes_unique_guest ON public.postcard_likes USING btree (postcard_id, guest_id) WHERE (guest_id IS NOT NULL);
-- 
-- ALTER TABLE public.profiles ADD COLUMN claimed_at timestamptz;
-- COMMENT ON COLUMN public.profiles.claimed_at IS '用途不明（已棄用）';
-- ALTER TABLE public.profiles ALTER COLUMN claimed_at DROP NOT NULL;

-- ---- 1b. 執行刪除 (確認後執行) ----
-- ALTER TABLE public.challenges DROP COLUMN IF EXISTS current_players;
-- ALTER TABLE public.postcard_likes DROP COLUMN IF EXISTS guest_id;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS claimed_at;

-- ---- 1c. guest_fly_posts.status (選擇性) ----
-- 這個欄位有 DDL 預設值 '開放報名中'，但前後端程式碼都未讀取它。
-- 卡片狀態完全由 slots (進場人數) 在前端判斷。
-- 如果你確認不需要，可以刪除：
-- ALTER TABLE public.guest_fly_posts DROP COLUMN IF EXISTS status;
-- 復原：
-- ALTER TABLE public.guest_fly_posts ADD COLUMN status text DEFAULT '開放報名中';


-- ============================================================================
-- 第二部分：未被程式碼呼叫的舊版 RPC (中風險)
-- 這些函數有新版替代，且經搜尋確認未被任何前端/Edge Function 呼叫
-- 刪除後如發現有功能異常，可用復原腳本重建
-- ============================================================================

-- ---- 復原腳本 (保留供參考，已在 DB_SCHEMA.md 記錄原始碼) ----
-- 所有 RPC 的完整原始碼都已備份於 DB_SCHEMA.md 中，
-- 可從該檔案複製原始碼重建。

-- ---- 執行刪除 (確認後逐行執行) ----
-- DROP FUNCTION IF EXISTS public.handle_challenge_signup;
-- DROP FUNCTION IF EXISTS public.cancel_signup_and_update_status;
-- DROP FUNCTION IF EXISTS public.increment_wishes;
-- DROP FUNCTION IF EXISTS public.create_user_with_profile(nickname text, password text, role text);  -- v1
-- DROP FUNCTION IF EXISTS public.create_user_with_profile(user_email text, user_password text, user_nickname text, user_role text);  -- v2
-- DROP FUNCTION IF EXISTS public.reset_user_password_by_nickname(target_nickname text, new_password text);
-- DROP FUNCTION IF EXISTS public.get_leaderboard(start_date text, end_date text);
-- DROP FUNCTION IF EXISTS public.get_speed_leaderboard(start_date text, end_date text);
-- DROP FUNCTION IF EXISTS public.delete_old_sent_challenges;
-- DROP FUNCTION IF EXISTS public.get_my_claim(claim text);
-- DROP FUNCTION IF EXISTS public.url_encode(data text);


-- ============================================================================
-- 第三部分：Enum 清理 (低風險)
-- '已配達' 這個 enum 值從未被任何程式碼寫入或讀取
-- ⚠️ PostgreSQL 不支援直接從 enum 刪除值，需要重建類型
-- 建議保留不動，除非你非常確定不需要
-- ============================================================================

-- 如果要刪除 '已配達'，必須重建整個 enum 類型（複雜且有風險）：
-- 1. 先將所有 challenges.status 改為相容值
-- 2. 建立新 enum 類型（不含 '已配達'）
-- 3. ALTER TABLE challenges ALTER COLUMN status TYPE new_type USING status::text::new_type
-- 4. DROP TYPE challenge_status
-- 5. ALTER TYPE new_type RENAME TO challenge_status
-- 
-- ⚠️ 不建議執行，風險大於收益。保留 enum 值不影響任何功能。


-- ============================================================================
-- 第四部分：⚠️ 不可清理的項目 (請勿刪除)
-- ============================================================================

-- 以下 RPC 雖然看似與 Edge Function 功能重複，但是被排程或其他機制使用：
-- 1. delete_old_challenges — 可能被排程使用（Edge Function cleanup-expired 也有類似功能）
-- 2. open_due_challenges — 被定時排程呼叫，批次開啟到期挑戰
-- 3. daily_reduce_absent_score — 被 admin.html 手動觸發
-- 4. reset_all_user_signup_counts — 被每日排程呼叫
-- 5. purge_old_signup_history — 被排程呼叫

-- 以下資料表請勿刪除或改動結構：
-- 1. signup_history — 由 trigger 自動管理，用於取消報名後重算最速紀錄
-- 2. absent_records — 缺席系統核心，trigger 聯動 absent_score
-- 3. daily_settings — 系統設定 + 通知指紋 (指紋用於 guest 留言功能)
-- 4. partners — 由暱稱修改 Edge Function 同步更新
