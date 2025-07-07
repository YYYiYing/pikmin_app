🍄 菇菇宅配網 - Pikmin Bloom 蘑菇報名系統 🍄
這是一個專為 Pikmin Bloom 玩家設計的蘑菇挑戰報名與管理平台，旨在提供一個中心化的介面，方便玩家發布、報名蘑菇挑戰，以及管理好友碼。系統採用了現代化的網頁技術棧，提供即時的資料更新、精細的角色權限管理與自動化的活動控管功能。

專案概述
本專案旨在解決遊戲中蘑菇挑戰協調的痛點，提供以下核心功能：

精細角色權限管理：支援四種使用者角色：報名者、發菇者 (僅發布)、發菇及報名者、管理者。

蘑菇挑戰發布與報名：具權限的使用者可發布各種類型、名額、開放時間的蘑菇挑戰；使用者可即時報名或取消報名。

每日限量報名機制：管理者可在後台設定全域的「每人每日報名次數上限」，並由資料庫於每日固定時間自動重置。

公平且穩健的排行榜：提供週/月排行的「報名王」與「最速傳說」。最速紀錄的取消操作具備**復歸(Rollback)**功能，能自動回溯至前一筆最佳成績，防止洗榜。

伺服器端自動化：關鍵的業務邏輯，如「挑戰開放狀態更新」與「排行榜計數器歸零」，皆由後端伺服器定時自動執行，確保了功能的絕對可靠性。

響應式介面：前端介面經優化，在桌面與行動裝置上皆有良好的操作體驗，並採用漢堡選單收納次要功能。

管理後台：管理者專用的介面，用於使用者管理、挑戰管理、以及每日報名上限設定。

便利功能：動態截圖、好友碼聯絡簿、在線人數顯示等。

核心架構與設計理念
本專案在迭代過程中，確立了幾個核心的設計原則，以確保系統的穩健性與可維護性。

1. 後端驅動的業務邏輯
所有核心且敏感的操作，如權限檢查、報名資格驗證、排行榜計分等，都封裝在 PostgreSQL 的資料庫函式 (RPC) 中。前端只負責呼叫這些函式，而不參與複雜的邏輯判斷。

2. 伺服器端自動化 (pg_cron)
系統的「心跳」由 Supabase 內建的 pg_cron 排程工具驅動，它負責執行週期性任務，不受任何使用者行為影響。

3. 數據完整性：永久成績日誌
為實現公平的排行榜「復歸」功能，並應對「挑戰卡片會被清除」的業務規則，本專案採用了永久日誌表 (signup_history) 的架構。透過在 signups 表上設置觸發器 (Trigger)，在任何報名紀錄被刪除前，都會先將其成績自動存檔至 signup_history，確保排行榜的計算數據源永不遺失。

技術棧
前端: HTML5, CSS3, JavaScript (ES6+), Tailwind CSS, Supabase JS Client, html2canvas

後端 (Supabase): PostgreSQL, pg_cron, Supabase Auth, Supabase Edge Functions (Deno/TypeScript), Supabase Realtime

程式語言: JavaScript, TypeScript, SQL (PL/pgSQL)

後端架構與自動化詳解
核心資料庫函式 (RPC)
以下為系統中幾個最關鍵的資料庫函式說明：

signup_for_challenge(challenge_id)

職責：處理單次報名的所有邏輯。

執行步驟：

時間驗證：檢查當前伺服器時間是否已晚於挑戰的 start_time，防止提前報名及產生負值的報名速度。

每日額度檢查：查詢 daily_settings 表取得上限值，再比對 profiles 表中該使用者的 daily_signup_count，確認未達當日上限。

名額檢查：鎖定要報名的挑戰，計算 signups 表中對應的現有報名人數，確認挑戰尚未額滿。

執行報名：通過所有檢查後，將新的報名紀錄（包含計算出的 signup_speed）INSERT 到 signups 表。

更新統計：UPDATE profiles 表，將該使用者的 daily_signup_count, weekly_signup_count, monthly_signup_count 都加一，並更新其 weekly/monthly_fastest_time（如果本次成績更快）。

更新挑戰狀態：如果報名後額滿，則更新 challenges 表的狀態。

cancel_signup_and_update_challenge(challenge_id)

職責：處理取消報名及其衍生的所有數據復歸。

執行步驟：

事前查詢：在刪除前，先從 signups 表中獲取該筆報名的 signup_speed，並從 profiles 表取得使用者當前的最速紀錄。

執行刪除：從 signups 表中 DELETE 該筆報名紀錄。（此動作會觸發 archive_signup_record 函式進行存檔）。

返還次數：UPDATE profiles 表，將 daily/weekly/monthly_signup_count 都減一。

最速時間復歸：判斷被取消的成績是否為當前的最速紀錄。如果是，則從永久的 signup_history 表中，重新查詢該使用者在當前時間區間內（本週/本月）所有剩下的紀錄，找出其中的最快成績 (MIN)，並用它來更新 profiles 表中的最速紀錄。如果已無其他紀錄，則更新為 NULL。

更新挑戰狀態：如果挑戰先前為「已額滿」，則將其狀態更新回「開放報名中」。

archive_signup_record() (由觸發器呼叫)

職責：這是一個觸發器函式，綁定在 signups 表的 BEFORE DELETE 事件上。

執行步驟：在任何一筆 signups 紀錄被刪除之前，此函式會被自動觸發，將該筆紀錄的 user_id, signup_speed, signed_up_at 複製一份並 INSERT 到 signup_history 表中。

自動化排程任務 (Cron Jobs)
系統透過 pg_cron 設定了多個定時任務，以 UTC 時間為標準執行。

挑戰狀態自動更新

任務名稱: challenge-opener

排程: * * * * * (每分鐘)

執行內容: 呼叫 open_due_challenges() 函式，將所有狀態為「預計開放」且 start_time 已到期的挑戰，自動更新為「開放報名中」。

每日報名次數重置

任務名稱: daily-signup-reset

排程: 0 16 * * * (每日 UTC 16:00)

說明: 對應台灣時間 (UTC+8) 的每日凌晨 00:00。呼叫 reset_all_user_signup_counts() 函式，將 profiles 表中所有使用者的 daily_signup_count 欄位重設為 0。

歷史紀錄月度清理

任務名稱: monthly-history-purge

排程: 0 0 1 * * (每月 1 號 UTC 00:00)

說明: 對應台灣時間 (UTC+8) 的每月 1 號早上 8:00。呼叫 purge_old_signup_history() 函式，刪除 signup_history 表中所有「上上個月」及更早的舊紀錄，以節省資料庫空間。

週/月排行榜計數重置 (既有)

週重置: jobid 4，排程為 0 16 * * 0 (每週日的 UTC 16:00)，對應台灣時間的週一凌晨 00:00，負責將 weekly_signup_count 等週計數歸零。

月重置: jobid 2，排程為 0 0 1 * * (每月 1 號的 UTC 00:00)，對應台灣時間的每月 1 號早上 8:00，負責將 monthly_signup_count 等月計數歸零。