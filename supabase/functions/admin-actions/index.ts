// 【最終權威版】index.ts - 採用 RPC 呼叫，最穩健安全

// --- 1. 引入必要的工具 ---
// 'serve' 是 Deno 執行環境提供的一個基本工具，它的功能就像一個網站伺服器，負責監聽網路請求並做出回應。
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// 'createClient' 是從 Supabase 官方函式庫引入的工具，用來建立與你的 Supabase 資料庫溝通的「客戶端物件」。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "web-push";

// --- 2. 設定 CORS 跨來源資源共用標頭 ---
// 這是一個重要的安全性設定。它像一張通行證，告訴瀏覽器，允許來自任何網域 ('*') 的前端網頁來請求這個後端函式的資料。
// 如果沒有這個設定，瀏覽器會基於「同源政策」拒絕前端（如 admin.html）的請求，導致無法取得資料。
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- 3. 啟動伺服器，監聽並處理所有進來的請求 ---
// 'serve(async (req) => { ... })' 會建立一個服務，每當有網路請求 (request, 簡寫為 req) 進來時，箭頭函式內的程式碼就會被執行。
serve(async (req) => {
  // 'OPTIONS' 請求是瀏覽器在發送真正的請求（如 GET, POST）之前，進行的一種「預檢(preflight)」請求。
  // 它用來詢問伺服器是否安全、是否允許接下來的正式請求。我們只需要回覆 'ok' 並附上 CORS 標頭即可。
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // 'try...catch' 是一個強大的錯誤處理機制。
  // 程式會嘗試執行 'try' 區塊內的所有程式碼。如果在任何一個環節發生錯誤，程式會立刻跳到 'catch' 區塊，並回傳一個格式化的錯誤訊息，而不是讓整個服務崩潰。
  try {
    // --- 步驟 1: 安全性檢查 - 確認請求者是合法的「管理者」---
    // 這個步驟就像是聘請一位「安全守門員」。

    // 我們建立一個「代表使用者」的 Supabase 客戶端。
    // 注意，這裡使用的是公開金鑰(PUBLIC_KEY)，並且關鍵地，我們從請求標頭中取出使用者登入時獲得的 'Authorization' Token。
    // 這相當於守門員拿著訪客的「臨時通行證」（Token）去驗證身份。
    const userSupabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', // 從環境變數讀取 Supabase URL
      Deno.env.get('PUBLIC_KEY') ?? '', // 從環境變數讀取公開金鑰
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } } // ★ 關鍵：使用前端傳來的 Token 進行驗證
    );
    // 使用這個帶有 Token 的客戶端，向 Supabase 詢問「這個 Token 是誰的？」
    const { data: { user } } = await userSupabaseClient.auth.getUser();
    if (!user) throw new Error('無效的使用者或 Token'); // 如果 Token 無效或過期，就直接拋出錯誤。

    // 驗證成功後，我們知道使用者是誰了 (user.id)，接著從 'profiles' 資料表查詢他的角色。
    const { data: profile, error: profileError } = await userSupabaseClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    // 如果查詢出錯，或者該使用者的角色不是「管理者」，則回傳 403 (Forbidden) 權限不足的錯誤。
    // 守門員確認此人不是管理者，不讓他進入。
    if (profileError || profile?.role !== '管理者') {
      return new Response(JSON.stringify({ error: '權限不足' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 403,
      });
    }

    // --- 步驟 2: 執行真正的管理員操作 ---
    // 只有通過了上面的權限檢查，程式才會繼續往下執行。

    // 現在，我們建立一個擁有「完全權限」的 Supabase 客戶端。
    // 這次我們使用的是 SECRET_KEY，這是一把「萬能鑰匙」，儲存在安全的後端環境變數中，絕不會外洩到前端。
    // 這個客戶端擁有最高的權限，可以執行新增/刪除使用者等敏感操作。
    const adminSupabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SECRET_KEY') ?? '' // ★ 關鍵：使用服務密鑰(SECRET_KEY)以獲得完整權限
    );
    
    // 解析前端發送過來的請求內容。請求中應包含 'action'（要做什麼）和 'payload'（操作所需的資料）。
    const { action, payload } = JSON.parse(await req.text());
    let data: unknown = null; // 用來存放成功執行的結果
    let error = null; // 用來存放執行失敗的錯誤

    // 'switch' 語句像一個總機，根據 'action' 的值，將請求分配到對應的處理區塊。
    switch (action) {
      // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
      // ★  【最終修正邏輯】改為呼叫我們建立的資料庫函式 (RPC)
      // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
      case 'list-users-with-details':
        {
            // 步驟 A: 使用「萬能鑰匙」從 'profiles' 表中獲取所有使用者的基本資料。
            const { data: profiles, error: profilesError } = await adminSupabaseClient.from('profiles').select('*');
            if (profilesError) throw profilesError;
            if (!profiles || profiles.length === 0) {
                data = { users: [] }; // 如果沒有使用者，回傳空陣列
                break;
            }

            // 步驟 B: 從剛才獲取的 profiles 中，整理出所有使用者的 ID 列表。
            const userIds = profiles.map(p => p.id);

            // 步驟 C: 【新方法】呼叫我們在 SQL Editor 中預先建立好的資料庫函式 'get_users_signin_data'。
            // 這就是 RPC (Remote Procedure Call，遠端程序呼叫)。
            // 它的意思是：「嘿！資料庫，請你直接執行一個叫做 'get_users_signin_data' 的內部函式，我把 user_ids 這個參數傳給你。」
            // 這樣做的好處是，我們不需要在程式碼中直接碰觸敏感的 `auth.users` 表，而是讓資料庫內部去處理，更安全、更高效。
            const { data: authData, error: rpcError } = await adminSupabaseClient
                .rpc('get_users_signin_data', { user_ids: userIds });

            if (rpcError) {
                console.error("RPC call failed:", rpcError); // 在後台印出詳細錯誤，方便除錯
                throw rpcError; // 拋出錯誤，中斷執行
            }

            // 步驟 D: 將 RPC 回傳的「最後上線時間」資料轉換成一個 Map 結構，方便快速查找。
            // Map 的結構是：{ '使用者ID-1': '上線時間-1', '使用者ID-2': '上線時間-2', ... }
            const authMap = new Map(authData.map((u: any) => [u.id, u.last_sign_in_at]));
            
            // 步驟 E: 合併資料。遍歷最初的 profiles 列表，並從 authMap 中找出每個使用者對應的 `last_sign_in_at`，然後組合在一起。
            const combinedUsers = profiles.map(profile => ({
                ...profile, // 保留 profile 的所有原始資料
                last_sign_in_at: authMap.get(profile.id) || null // 加上最後上線時間
            }));
            
            // 將合併後的完整使用者列表作為最終結果。
            data = { users: combinedUsers };
        }
        break; // 結束這個 case 的處理

        // --- 其他操作的邏輯保持不變 ---
        
        // 在 index.ts 的 switch(action) 中，替換掉舊的 'create-user' case
        case 'create-user':
          {
        // ★ 修改：先解析出乾淨的暱稱，再用它來生成虛擬信箱
        const cleanNickname = (payload.nickname || '').split(/[^a-zA-Z0-9\u4e00-\u9fa5\s]/)[0];
        const virtualEmail = `${encodeURIComponent(cleanNickname)}@pikmin.sys`;

          // 使用 admin 權限的 client，以剛生成的虛擬 Email 建立認證使用者。
          // 我們也加上 email_confirm: true，這是管理員建立帳號時的最佳實踐。
          const { data: created, error: createErr } = await adminSupabaseClient.auth.admin.createUser({
            email: virtualEmail, // ★ 使用後端自行生成的 virtualEmail
            password: payload.password,
            email_confirm: true // ★ 確保使用者為已驗證狀態
          });
          
          // 如果建立認證使用者時出錯，直接拋出錯誤。
          if (createErr) throw createErr;
          
          // 如果認證使用者成功建立，接著在他的 public.profiles 表中新增對應的公開資料。
          if (created.user) {
              const { error: profileErr } = await adminSupabaseClient.from('profiles').insert({
                  id: created.user.id,
                  // ★ 修改：儲存的依然是包含圖示與數字的完整暱稱
                  nickname: payload.nickname,
                  role: payload.role
              });
              
              // 【重要】如果 profile 寫入失敗，這會導致資料不一致（有一個沒有個人資料的孤兒帳號）。
              // 所以我們必須手動將剛才建立的認證使用者刪除，進行「交易復原」。
              if (profileErr) {
                await adminSupabaseClient.auth.admin.deleteUser(created.user.id);
                throw new Error(`建立 Profile 失敗: ${profileErr.message}`);
              }
              // 一切順利，將成功建立的使用者資訊回傳
              data = created;
          }
        }
        break;
      
      case 'update-user-role':
        // 更新 'profiles' 表中指定 userId 的角色。
        ({ data, error } = await adminSupabaseClient.from('profiles')
            .update({ role: payload.role })
            .eq('id', payload.userId)
            .select());
        break;

      case 'reset-user-password':
        // 使用 admin 客戶端的 `updateUserById` 方法重設使用者的密碼。
        ({ data, error } = await adminSupabaseClient.auth.admin.updateUserById(
          payload.userId,
          { password: payload.password }
        ));
        break;

      case 'delete-challenge':
        // 從 'challenges' 表中刪除指定的挑戰。
        ({ error } = await adminSupabaseClient.from('challenges')
            .delete()
            .eq('id', payload.challengeId));
        break;

      case 'delete-user':
        // 使用 admin 客戶端的 `deleteUser` 方法，將使用者從認證系統和資料庫中徹底刪除（因為我們設定了級聯刪除）。
        if (!payload.userId) throw new Error('缺少 userId');
        ({ data, error } = await adminSupabaseClient.auth.admin.deleteUser(payload.userId));
        break;

      // ★ 修改：更新使用者暱稱的 action，增加同步更新 auth.email 的步驟
      case 'update-user-nickname':
        {
          if (!payload.userId || !payload.oldNickname || !payload.newNickname) {
              throw new Error('缺少必要參數');
          }

          // 步驟 1: 解析新暱稱，產生新的虛擬信箱
          const cleanNickname = (payload.newNickname || '').split(/[^a-zA-Z0-9\u4e00-\u9fa5\s]/)[0];
          const newVirtualEmail = `${encodeURIComponent(cleanNickname)}@pikmin.sys`;

          // 步驟 2: 使用管理者權限，更新 auth.users 表中的 email
          const { error: authError } = await adminSupabaseClient.auth.admin.updateUserById(
              payload.userId,
              { email: newVirtualEmail }
          );
          if (authError) throw new Error(`更新認證 Email 失敗: ${authError.message}`);

          // 步驟 3: 更新 profiles 表中的暱稱
          const { error: profileError } = await adminSupabaseClient.from('profiles')
              .update({ nickname: payload.newNickname })
              .eq('id', payload.userId);
          if (profileError) throw profileError;

          // 步驟 4: 同步更新 partners 表中對應的名稱
          const { error: partnerError } = await adminSupabaseClient.from('partners')
              .update({ name: payload.newNickname })
              .eq('name', payload.oldNickname);
          if (partnerError) {
              console.warn(`更新 partner 名稱時發生非致命錯誤: ${partnerError.message}`);
          }
        }
      break;

     // ★ 新增：獲取每日報名上限的 action
     case 'get-daily-limit':
       ({ data, error } = await adminSupabaseClient.from('daily_settings')
           .select('setting_value')
           .eq('setting_name', 'daily_signup_limit')
           .single());
       break;
 
     // ★ 新增：更新每日報名上限的 action
     case 'set-daily-limit':
       ({ data, error } = await adminSupabaseClient.from('daily_settings')
           .update({ setting_value: payload.value, updated_at: new Date().toISOString() })
           .eq('setting_name', 'daily_signup_limit')
           .select()
           .single());
       break;

      case 'ping':
        // 一個用來測試連線的空操作，不做任何事，能成功回傳即代表連線正常。
        break;

      // ★ 新增：發送 Web Push 通知的 action
      case 'send-push-notification':
        {
          const { recipient_user_id, payload } = payload;
          if (!recipient_user_id || !payload) throw new Error('缺少必要的推播參數');

          // 1. 從資料庫中找出該使用者的所有訂閱資訊
          const { data: subscriptions, error: subError } = await adminSupabaseClient
            .from('push_subscriptions')
            .select('subscription_data')
            .eq('user_id', recipient_user_id);

          if (subError) throw subError;
          if (!subscriptions || subscriptions.length === 0) {
            console.warn(`找不到使用者 ${recipient_user_id} 的訂閱資訊，略過通知。`);
            break; // 結束此 case
          }

          // 2. 設定 VAPID 金鑰資訊
          const vapidKeys = {
            publicKey: Deno.env.get('VAPID_PUBLIC_KEY')!, // 公鑰也建議設為環境變數
            privateKey: Deno.env.get('VAPID_PRIVATE_KEY')!,
          };
          webpush.setVapidDetails('mailto:your-email@example.com', vapidKeys.publicKey, vapidKeys.privateKey);

          // 3. 遍歷所有訂閱，並發送推播
          for (const sub of subscriptions) {
            try {
              await webpush.sendNotification(sub.subscription_data, JSON.stringify(payload));
            } catch (pushError) {
              console.error(`向使用者 ${recipient_user_id} 的某個訂閱發送推播失敗:`, pushError);
              // 如果錯誤是 410 Gone，代表這個訂閱已失效，可以從資料庫中刪除
              if (pushError.statusCode === 410) {
                await adminSupabaseClient
                  .from('push_subscriptions')
                  .delete()
                  .eq('subscription_data', sub.subscription_data);
              }
            }
          }
        }
        break;

      default:
        // 如果傳來的 action 是未定義的，拋出錯誤。
        throw new Error(`未知的操作: ${action}`);
    }

    // 如果前面的 `switch` 區塊中發生了錯誤 (`error` 變數有值)，就在這裡拋出，讓 `catch` 區塊捕捉。
    if (error) throw error;

    // --- 步驟 3: 成功回傳結果 ---
    // 所有操作都順利完成，將結果包裝成 JSON 格式回傳給前端，並附上 200 (OK) 的狀態碼。
    return new Response(JSON.stringify({ success: true, data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (err) {
    // --- 步驟 4: 失敗回傳錯誤 ---
    // 如果在 'try' 區塊的任何地方發生錯誤，程式會跳到這裡。
    // 我們將錯誤訊息包裝成 JSON 格式回傳給前端，並附上 400 (Bad Request) 的狀態碼，讓前端知道請求失敗了。
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});