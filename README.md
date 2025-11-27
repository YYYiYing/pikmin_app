🍄 菇菇宅配網 (Pikmin Bloom Mushroom Signup System)
專為 Pikmin Bloom 玩家設計的蘑菇揪團互助平台。提供即時報名、倒數計時、發車通知與許願池功能，旨在解決玩家尋找隊友與協調時間的痛點。

📖 專案簡介
本系統採用 Serverless 架構，前端為純靜態頁面 (HTML/JS)，後端完全依賴 Supabase 提供的 Database、Auth、Edge Functions 與 Realtime 功能。透過 GitHub Actions 執行定期排程，實現自動化的郵件通知與資料清理。

🏗️ 系統架構 (System Architecture)
核心技術堆疊
Frontend: HTML5, Vanilla JavaScript (ES6+), Tailwind CSS (CDN).
Backend / DB: Supabase (PostgreSQL).
Auth: Supabase Auth (Email/Password, Custom Virtual Email for Admins).
Logic: Supabase Edge Functions (Deno/TypeScript).
Storage: Supabase Storage (用於儲存蘑菇明信片).
Automation: GitHub Actions (Cron Jobs).
Notifications: Resend API + Google Groups.

資料流向
即時互動: 前端透過 Supabase Realtime 監聽 challenges 與 signups 資料表，實現不需重新整理的即時列表更新。
排程通知: GitHub Actions 每 30 分鐘觸發 Edge Function -> 掃描資料庫 -> 透過 Resend 發送通知至 Google Groups。
許願系統: 使用者投票 -> 寫入 daily_wish_count 與 wish_stats -> SQL 排程每日/每週自動重置。

✨ 主要功能 (Key Features)
1. 蘑菇挑戰看板 (Dashboard)
即時狀態: 顯示蘑菇種類、剩餘名額、火侯（戰力要求）、倒數計時。
倒數系統: 包含「開放報名倒數」與「戰鬥/收成時間倒數」。
報名機制: 防止重複報名、每日額度限制、操作冷卻時間 (3秒)。
圖片瀏覽: 支援上傳與預覽蘑菇明信片。

RWD 設計: 針對手機版優化的緊湊介面，支援寬度自適應顯示。
2. 🌟 許願池 (Wishing Well) [NEW]
視覺化統計: 以堆疊長條圖顯示當前熱門精華需求（巨菇、活動菇、各色精華）。
互動機制: 每人每日可投 3 票，支援單次複選。
自動重置:
每日 00:00: 重置個人投票額度。
每週一 00:00: 清空許願池統計數據。
UI 優化: 依據視窗寬度智慧顯示/隱藏圖示與數字，手機版保持極簡色塊。

3. 智慧通知系統 (Smart Notifications) [Optimized]
報名通知: 當有新蘑菇開放時，通知訂閱群組。
額滿發車提醒: 針對發菇者發送提醒。
用餐時段過濾邏輯: 避免過早打擾，依據時段智慧判斷是否發送通知：
早餐 (06:00+) / 午餐 (11:00+) / 下午茶 (14:00+) / 晚餐 (17:00+) / 宵夜 (21:00+)。
若未達用餐時間，即使額滿也不會發送通知；過期未發則強制提醒。

4. 管理後台 (Admin Panel)
使用者管理: 新增、刪除、修改暱稱/角色、重設密碼。
全域設定: 調整每日報名上限。
手動觸發: 強制執行通知檢查、發送測試信。
挑戰管理: 強制刪除違規或錯誤的挑戰（連動刪除圖片）。

5. 排行榜 (Leaderboard)
每 30 分鐘更新數據，統計「發菇王」、「報名王」與「最速傳說」。
支援「本週」與「本月」切換。

🚀 近期更新日誌 (Recent Updates)
[Feat] 許願池 v2.0:
資料庫改為計數器 (daily_wish_count) 取代布林值，允許分次投票。
新增圖示支援 (🍄 巨菇/活動菇)，優化長條圖高度與對齊。

[Fix] 通知邏輯優化:
實作 mealStartHours 邏輯，解決隔日預約單在非用餐時段誤報的問題。
訂閱/退訂流程優化，加入轉址至 Google Groups 的防呆提示。

[Refactor] 前端重構:
導入 事件委派 (Event Delegation)，大幅減少 DOM 監聽器數量，提升效能。
模組化 JavaScript 程式碼 (Init / UI / Data / Interaction)。

[UI] 介面微調:
手機版許願池高度縮減 (h-7)，文字大小自適應 (text-[10px])。
修復「重新整理」按鈕失效問題。

🛠️ 開發與部署
本專案無需傳統後端伺服器。

資料庫: 匯入 schema.sql 至 Supabase。
後端: 部署 supabase/functions 至 Supabase Edge Functions。
前端: 任何靜態網頁託管服務 (GitHub Pages, Vercel, Netlify) 即可運作。
排程: 設定 GitHub Secrets (SUPABASE_URL, SECRET_KEY, RESEND_API_KEY) 並啟用 GitHub Actions。
