好的，這是一個很好的想法。隨著功能迭代，保持 README.md 文件的同步更新至關重要。

我已經將我們近期所有的新增功能與修正，整合進您原有的說明文件中。這份更新後的 README.md 檔案反映了專案的最新狀態。

您可以直接複製以下所有內容，來更新您的 README.md 檔案。

🍄 菇菇宅配網 - Pikmin Bloom 蘑菇報名系統 🍄
這是一個專為 Pikmin Bloom 玩家設計的蘑菇挑戰報名與管理平台，旨在提供一個中心化的介面，方便玩家發布、報名蘑菇挑戰，以及管理好友碼。系統採用了現代化的網頁技術棧，提供即時的資料更新與多角色權限管理功能。

專案概述
本專案旨在解決遊戲中蘑菇挑戰協調的痛點，提供以下核心功能：

使用者認證與權限管理：支援多種使用者角色（報名者、發菇者、管理者），並依據角色提供不同的操作權限。

蘑菇挑戰發布與報名：發菇者可以發布各種類型、名額、開放時間的蘑菇挑戰；報名者可以即時報名或取消報名；挑戰卡片會顯示參與者列表與報名時間。

即時更新：利用 Supabase Realtime 功能，確保蘑菇挑戰列表和好友聯絡簿資料即時同步。

排行榜：提供不同時間區間（週/月）的報名次數與最速報名排行榜。

好友碼分享：提供一個共用的聯絡簿，方便玩家共享與查找好友碼。

動態截圖功能：使用者可一鍵擷取當前篩選條件下的挑戰列表，並下載為圖片，方便分享。

管理後台：管理者專用的介面，用於使用者管理（新增、重設密碼、修改角色、刪除）、挑戰管理（刪除），並即時監控資料庫連線狀態。

自動清理機制：已發送的蘑菇挑戰在一定時間後會自動從資料庫中清除。

技術棧
前端:

HTML5 / CSS3: 基礎頁面結構與樣式。

Tailwind CSS: 快速建構響應式與現代化 UI 的實用工具函式庫。

Supabase JS Client: 前端與 Supabase 後端服務（認證、資料庫、Edge Functions）互動的核心。

html2canvas: 用於實現將 HTML 元素（挑戰列表）轉換為圖片的功能。

後端:

Supabase: 提供完整後端即服務解決方案，包含：

PostgreSQL 資料庫: 儲存所有應用程式資料。

Supabase Auth: 處理使用者註冊、登入與會話管理。

Supabase Edge Functions (Deno): 部署客製化後端邏輯，處理敏感操作（如使用者管理、測試資料庫連線）和複雜查詢（如排行榜）。

Supabase Realtime: 提供資料庫變動的即時訂閱功能。

程式語言:

JavaScript: 前端邏輯實現。

TypeScript: 用於 Supabase Edge Functions (index.ts)，提供型別安全。

SQL (PostgreSQL): 資料庫結構定義、Stored Procedures / Functions (如 signup_for_challenge, cancel_signup_and_update_challenge, get_users_signin_data, get_leaderboard_from_profiles, get_speed_leaderboard_from_profiles, update_last_active 等)。

檔案結構
專案主要由以下幾個 HTML 頁面和一個 TypeScript 後端函式構成：

index.html: 登入頁面。

dashboard.html: 主要的蘑菇挑戰列表與報名頁面，也是使用者登入後的首頁。

partner.html: 好友碼聯絡簿頁面。

admin.html: 管理者專用的後台管理頁面。

mashroom.png, mashroom_s.png: 網站圖示資源。

index.ts: 部署在 Supabase Edge Functions 的後端邏輯，處理敏感的管理員操作與複雜的資料查詢。

功能詳情與實作細節
1. 登入頁 (index.html)
使用者介面: 提供暱稱選擇下拉選單和密碼輸入框。

暱稱填充: 頁面載入時會自動從 profiles 表中獲取所有暱稱，並按英文優先、中文筆劃的順序排序。

「記住我」功能: 若使用者勾選，會將暱稱儲存在瀏覽器的 localStorage 中，下次造訪時自動帶入。

登入邏輯: 將使用者輸入的暱稱轉換為虛擬 Email 格式 ([nickname]@pikmin.sys)，然後透過 Supabase 進行認證。

初始會話檢查: 頁面載入時會檢查是否存在有效的 Supabase Session，若已登入則直接跳轉至 dashboard.html。

2. 主控台頁 (dashboard.html)
主要功能: 顯示蘑菇挑戰列表、提供報名/取消報名、發布新挑戰、以及截圖分享。

使用者資訊: 頁面頂部顯示當前登入使用者的暱稱，並透過呼叫 update_last_active RPC 即時更新使用者的「最後活躍時間」。

權限導航:

「發布新挑戰」按鈕 (post-challenge-button)：僅在角色為「發菇者」或「管理者」時顯示。

「我的發布」篩選分頁 (hosted-tab)：僅在角色為「發菇者」或「管理者」時顯示。

「管理後台」連結 (admin-link)：僅在角色為「管理者」時顯示。

蘑菇挑戰列表 (challenges-list):

資料獲取: 從 challenges 表中獲取所有挑戰，並關聯載入發布者暱稱及報名者列表。

卡片渲染: 每個挑戰顯示為一張卡片，包含蘑菇種類、發布者、名額、狀態等。

報名邏輯: 透過呼叫 Supabase 的資料庫函式 (RPC) signup_for_challenge 或 cancel_signup_and_update_challenge 實現，確保操作的原子性與資料一致性。

發菇者控制: 發布者可以在自己的挑戰卡片上看到「編輯」和「刪除」按鈕，並可以點擊「已發/待發」標籤切換狀態。

編輯挑戰: 彈出式視窗允許發布者修改挑戰內容。新增了「立即開放」按鈕，方便快速將挑戰時間設定為當前。

倒數計時器: 對於「預計開放」的挑戰，卡片上會顯示倒數計時，時間到達時自動更新挑戰狀態。

發布新挑戰 (challenge-modal):

彈出式表單，允許發菇者填寫挑戰細節。

提供「立即開放」按鈕和「記住時間」功能，提升使用者體驗。

排行榜 (leaderboard-modal):

提供「報名王」和「最速」兩種排行榜，並可按週/月切換。

資料透過呼叫 Supabase Edge Functions 獲取。

在線人員列表 (online-users-modal):

利用 Supabase Realtime Presence 功能，即時顯示當前在線的使用者暱稱列表。

截圖功能 (screenshot-button):

整合 html2canvas 函式庫，提供截圖功能。

使用者點擊按鈕後，可將當前篩選器下所有可見的挑戰卡片擷取為一張 PNG 圖片並下載。

截圖過程提供「截圖中...」的忙碌提示，並以當前時間為圖片命名，避免重名。

3. 好友聯絡簿頁 (partner.html)
功能: 允許使用者新增、編輯、刪除好友碼，並提供查找和排序功能。

操作便利性: 提供一鍵複製好友碼的功能，並透過 Realtime 確保資料即時同步。

4. 管理後台頁 (admin.html)
登入限制: 只有角色為「管理者」的使用者才能登入。

蘑菇挑戰管理:

顯示所有蘑菇挑戰的卡片列表，並提供刪除功能。

卡片右上角同步顯示「已發/待發」狀態標籤，與主控台頁面保持資訊一致。

使用者列表:

顯示所有使用者，包含暱稱、角色、每月參與度。

新增「最後活躍時間」指標：取代原有的「最後上線時間」，此時間戳會在使用者每次訪問主控台頁面時更新，能更準確地反映用戶的活躍度，為管理者判斷不活躍帳號提供依據。

提供完整的排序、改密碼、改角色、刪除等管理功能。

資料庫連線狀態: 定期檢查與 Supabase 的連線狀況並顯示狀態燈。

即時資料同步: 同樣透過 Supabase Realtime 訂閱 profiles 和 challenges 表的變動，確保列表即時更新。

5. 後端 Edge Function (index.ts)
安全性核心: 所有敏感的管理員操作（如使用者管理）都透過呼叫此 Edge Function 執行，確保服務密鑰 (SECRET_KEY) 永遠不會暴露在前端。

權限驗證: 在執行任何操作前，會嚴格驗證請求者的 Authorization Token，確保只有「管理者」角色才能執行這些敏感操作。

操作分派: 根據前端請求的 action 參數，分派到不同的處理邏輯，如 list-users-with-details, create-user, delete-user 等。

錯誤處理: 使用 try...catch 捕捉所有可能發生的錯誤，並回傳標準化的 JSON 錯誤訊息。

資安考量與現有防護
專案在資安方面已採取了一些重要措施：

敏感操作後端化: 所有涉及使用者帳號管理等敏感操作，都部署在 Supabase Edge Functions，確保服務密鑰不會暴露在前端。

角色權限驗證: Edge Function 在執行任何管理員操作前，會嚴格驗證請求者的角色。

RPC 應用: 透過資料庫函式 (RPC) 間接查詢或執行操作，避免了直接暴露過多權限，進一步限制了權限範圍。

交易回滾機制: 在 create-user 函式中，如果建立認證使用者後 profiles 表插入失敗，會自動回滾刪除剛建立的認證使用者，防止資料不一致。

RLS 啟用: 資料庫啟用了資料列層級安全性 (Row-Level Security)，所有資料存取都需遵循預先設定好的安全策略 (Policy)。

HTML 內容跳脫: 在渲染使用者輸入的內容時，使用了 escapeHtml 函式來防止潛在的 XSS 攻擊。