// 【最終整合修復版 v7】index.ts
// 結合權威版使用者管理邏輯 + 最新版通知系統

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// 設定接收通知的中繼信箱 (Resend 測試模式請務必設為您的註冊信箱)
const RELAY_TARGET_EMAIL = 'secretsoulful@gmail.com';

// --- 核心函式：檢查蘑菇並發信 (來自最新版通知邏輯) ---
async function checkAndSendNotification(supabase: any, resendApiKey: string, isTest = false) {
    // 1. 查詢目前「開放中」且「未額滿」的挑戰
    const { data: challenges, error: dbError } = await supabase
        .from('challenges')
        .select('*, signups(*)')
        .eq('status', '開放報名中');
    
    if (dbError) throw dbError;

    const activeChallenges = challenges.filter((c: any) => {
        const signupCount = c.signups ? c.signups.length : 0;
        return signupCount < c.slots;
    });

    // 如果沒有開放中的挑戰，且不是手動觸發，則不發信直接結束
    if (activeChallenges.length === 0 && !isTest) {
        return { sent: false, message: '無開放中的挑戰，不需發信' };
    }

    // 2. 組合 Email 內容
    const timeString = new Date().toLocaleString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' });
    
    let emailHtml = `
        <div style="font-family: sans-serif; color: #333;">
            <h2 style="color: #4f46e5;">🍄 蘑菇報名快訊 [${timeString}]</h2>
    `;

    if (activeChallenges.length > 0) {
        emailHtml += `<p>目前統計共有 <strong>${activeChallenges.length}</strong> 朵蘑菇開放報名中(未額滿)：</p>
            <ul style="list-style: none; padding: 0;">`;
            
        activeChallenges.forEach((c: any) => {
            const left = c.slots - (c.signups ? c.signups.length : 0);
            const startTime = new Date(c.start_time).toLocaleString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' });
            emailHtml += `
                <li style="background: #f3f4f6; margin-bottom: 10px; padding: 10px; border-radius: 8px; border-left: 4px solid #10b981;">
                    <strong style="font-size: 1.1em;">${c.mushroom_type}</strong> (${c.details})<br>
                    <span style="color: #555;">🕒 ${startTime} 開放 | 🔥 尚缺 <strong>${left}</strong> 人</span>
                </li>
            `;
        });
        emailHtml += `</ul>`;
    } else {
         emailHtml += `<p>目前沒有開放中的蘑菇 (這是手動觸發的檢查)。</p>`;
    }

    emailHtml += `
            <p style="margin-top: 20px;">
                <a href="https://yyyiying.github.io/pikmin_app/dashboard.html" style="background-color: #4f46e5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">👉 點此前往報名</a>
            </p>
            <p style="margin-top: 10px;">
                <a href="https://groups.google.com/g/mushroom_notify/membership" style="font-size: 0.85em; color: #6b7280; text-decoration: underline;">🔕 暫時不需要通知？點此前往 Google Groups 設定</a>
            </p>
            <p style="font-size: 0.8em; color: #888; margin-top: 20px;">本郵件由系統自動發送至群組。</p>
        </div>`;

    // 3. 發送 (為了測試模式穩定，簡化收件人設定)
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendApiKey}` },
        body: JSON.stringify({
            from: 'Mushroom Bot <onboarding@resend.dev>',
            to: [RELAY_TARGET_EMAIL], 
            // ★ 修改：主旨改為 [來吃喲!]
            subject: `[來吃喲!] ${activeChallenges.length > 0 ? activeChallenges.length + ' 朵蘑菇開放中！' : '目前無新挑戰'}`,
            html: emailHtml,
        }),
    });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Resend API Error (${res.status}): ${errorText}`);
    }

    return { sent: true, message: `通知已發送 (含 ${activeChallenges.length} 筆挑戰)` };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // 初始化 Admin Client (使用 Service Role Key)
    const adminSupabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SECRET_KEY') ?? '' 
    );

    const requestText = await req.text();
    const { action, payload } = requestText ? JSON.parse(requestText) : { action: null, payload: null };
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

    let data: unknown = null;


    // ============================================================
    // 區塊 A：系統自動化 (不需要一般使用者 Auth Header，使用 Service Role 執行)
    // ============================================================

    // 1. 排程發信通知 (報名通知 - 寄給訂閱群組)
    if (action === 'scheduled-email-notify') {
        if (!RESEND_API_KEY) throw new Error('缺少 RESEND_API_KEY');
        // 維持原邏輯：檢查開放中的蘑菇 -> 寄給 RELAY_TARGET_EMAIL
        const result = await checkAndSendNotification(adminSupabaseClient, RESEND_API_KEY, false);
        return new Response(JSON.stringify({ success: true, data: result }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    }

    // ★★★ 新增：排程發信通知 (額滿通知 - 針對發菇者分眾寄信) ★★★
// ★★★ 修改：排程發信通知 (額滿通知 - 匯總報告給管理員) ★★★
    if (action === 'scheduled-full-notify') {
        if (!RESEND_API_KEY) throw new Error('缺少 RESEND_API_KEY');

        // A. 查詢條件：狀態="已額滿" 且 發送狀態!="已發"
        const { data: fullMushrooms, error: dbError } = await adminSupabaseClient
            .from('challenges')
            .select('*, host:profiles!inner(nickname)')
            .eq('status', '已額滿')
            .neq('dispatch_status', '已發');

        if (dbError) throw dbError;

        if (!fullMushrooms || fullMushrooms.length === 0) {
            return new Response(JSON.stringify({ success: true, data: { message: '無待發送的額滿蘑菇' } }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
        }

        // B. 資料分組：依照 host.nickname 進行分組
        const reportMap: Record<string, any[]> = {};
        fullMushrooms.forEach((m: any) => {
            const nickname = m.host?.nickname || '未知';
            if (!reportMap[nickname]) {
                reportMap[nickname] = [];
            }
            reportMap[nickname].push(m);
        });

        // C. 產生匯總 HTML 內容
        let contentHtml = '';
        let hostIndex = 1;

        for (const [nickname, mushrooms] of Object.entries(reportMap)) {
            const listHtml = mushrooms.map((m: any) => {
                 // 格式：蘑菇類型、用餐時段、名額
                 return `<li style="margin-bottom: 4px; color: #555;">
                    ${m.mushroom_type} | ${m.details || '未指定'} | ${m.slots}人
                 </li>`;
            }).join('');

            // ★ 修改：去除中括號，並將 nickname 改為藍色 (#2563eb)
            contentHtml += `
                <div style="margin-bottom: 20px; padding: 10px; background-color: #f9fafb; border-left: 4px solid #db2777; border-radius: 4px;">
                    <h3 style="margin: 0 0 8px 0; font-size: 16px; color: #333;">
                        第${hostIndex}位 <span style="color: #2563eb; font-weight: bold;">${nickname}</span> 目前統計共有 <span style="color: #db2777;">${mushrooms.length}</span> 朵蘑菇未發送：
                    </h3>
                    <ul style="margin: 0; padding-left: 20px; font-size: 14px;">
                        ${listHtml}
                    </ul>
                </div>
            `;
            hostIndex++;
        }

        const emailHtml = `
            <div style="font-family: sans-serif; color: #333; max-width: 600px;">
                <h2 style="color: #db2777; border-bottom: 2px solid #db2777; padding-bottom: 10px;">🔔 蘑菇額滿待發清單</h2>
                <p>系統掃描報告：共有 <strong>${Object.keys(reportMap).length}</strong> 位發菇者需要發送邀請。</p>
                
                ${contentHtml}

                <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;">
                <p style="font-size: 12px; color: #999;">
                    此郵件由系統自動生成並寄送至中繼信箱。<br>
                    請確認後協助通知相關發菇者。
                </p>
            </div>
        `;

        // D. 寄送單一信件 (設定顯示名稱)
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
            body: JSON.stringify({
                from: 'Mushroom Bot <onboarding@resend.dev>',
                // ★ 這裡設定顯示名稱，隱藏直接的 Email 顯示
                to: [RELAY_TARGET_EMAIL], 
                subject: `[發車囉!] 共有 ${fullMushrooms.length} 朵蘑菇待發送`,
                html: emailHtml,
            }),
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Resend API Error: ${errText}`);
        }

        return new Response(JSON.stringify({ 
            success: true, 
            data: { 
                message: `匯總報告已發送 (含 ${fullMushrooms.length} 朵蘑菇)`,
            } 
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    }

    // 2. 排程清理逾時挑戰 (GitHub Actions 每 30 分鐘觸發)
    if (action === 'cleanup-expired') {
        // --- 設定逾時時數 (可在此調整) ---
        const HOURS_LIMIT = 12; 
        
        // 計算截止時間：目前時間 減去 12小時
        const cutoffTime = new Date(Date.now() - HOURS_LIMIT * 60 * 60 * 1000).toISOString();

        // --- 步驟 1：查詢符合刪除條件的挑戰 ---
        // 條件：
        // 1. 狀態必須是 '已發'
        // 2. 發出時間 (dispatched_at) 必須早於 截止時間
        // 3. (隱含邏輯) dispatched_at 為 NULL 的資料會被自動忽略，不會誤刪
        const { data: expiredChallenges, error: findErr } = await adminSupabaseClient
            .from('challenges')
            .select('id, image_url, mushroom_type, dispatched_at')
            .eq('dispatch_status', '已發')
            .lt('dispatched_at', cutoffTime);

        if (findErr) throw findErr;

        const deletedLog = [];

        // --- 步驟 2：執行刪除流程 ---
        if (expiredChallenges && expiredChallenges.length > 0) {
            for (const challenge of expiredChallenges) {
                // A. 優先處理照片刪除 (如果有照片)
                if (challenge.image_url) {
                    try {
                        // 從網址中解析出檔名 (例如: 173245xxxx.jpg)
                        const fileName = challenge.image_url.split('/').pop();
                        if (fileName) {
                            // 呼叫 Storage API 移除檔案
                            const { error: imgErr } = await adminSupabaseClient
                                .storage
                                .from('challenge-images')
                                .remove([fileName]);
                                
                            if (imgErr) console.error(`照片刪除警告 (ID: ${challenge.id}):`, imgErr);
                        }
                    } catch (e) {
                        console.error(`照片路徑解析失敗 (ID: ${challenge.id}):`, e);
                    }
                }

                // B. 照片處理完畢後，刪除資料庫紀錄
                const { error: delErr } = await adminSupabaseClient
                    .from('challenges')
                    .delete()
                    .eq('id', challenge.id);
                
                if (!delErr) {
                    deletedLog.push(`[已刪除] ${challenge.mushroom_type} (ID: ${challenge.id}, 發出於: ${new Date(challenge.dispatched_at).toLocaleString()})`);
                } else {
                    console.error(`資料刪除失敗 (ID: ${challenge.id}):`, delErr);
                }
            }
        }

        return new Response(JSON.stringify({ 
            success: true, 
            data: { 
                message: `清理作業完成`, 
                deleted_count: deletedLog.length, 
                details: deletedLog 
            } 
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    }

    // ============================================================
    // 區塊 B：使用者驗證 (需要 Authorization Header)
    // ============================================================
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('缺少 Authorization Header');

    const userSupabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('PUBLIC_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await userSupabaseClient.auth.getUser();
    if (userError || !user) throw new Error('無效的使用者或 Token');

    // --- B1. 一般使用者功能 ---
    if (action === 'update-subscription') {
        if (payload.userId !== user.id) throw new Error('權限不足');
        
        // ★ 修改：根據 payload.type 決定要更新哪個欄位
        // payload.type 預設為 'signup' (報名通知), 若為 'full' 則更新額滿通知
        const column = payload.type === 'full' ? 'full_notification_email' : 'notification_email';
        
        // 動態更新欄位
        const updateData: any = {};
        updateData[column] = payload.email;

        const { error } = await adminSupabaseClient.from('profiles').update(updateData).eq('id', user.id);
        
        if (error) throw error;
        
        const typeText = payload.type === 'full' ? '額滿通知' : '報名通知';
        return new Response(JSON.stringify({ 
            success: true, 
            data: { message: payload.email ? `${typeText}訂閱成功` : `已取消${typeText}` } 
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // --- B2. 管理員專屬功能 (檢查 role) ---
    const { data: profile } = await adminSupabaseClient.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== '管理者') return new Response(JSON.stringify({ error: '權限不足' }), { status: 403, headers: corsHeaders });

    switch (action) {
        // ★★★ 這裡完整恢復了「權威版」的使用者列表邏輯 (RPC) ★★★
        case 'list-users-with-details':
            // 1. 獲取所有使用者 Profile
            const { data: profiles, error: profilesError } = await adminSupabaseClient.from('profiles').select('*');
            if (profilesError) throw profilesError;
            if (!profiles || profiles.length === 0) { data = { users: [] }; break; }
            
            // 2. 準備 ID 列表
            const userIds = profiles.map((p: any) => p.id);

            // 3. 呼叫 RPC (資料庫函式)
            const { data: authData, error: rpcError } = await adminSupabaseClient
                .rpc('get_users_signin_data', { user_ids: userIds });
            
            if (rpcError) {
                 console.error("RPC call failed:", rpcError); 
                 throw rpcError; 
            }

            // 4. 建立 Map 加速查找
            const authMap = new Map(authData.map((u: any) => [u.id, u.last_sign_in_at]));
            
            // 5. 合併資料
            const combinedUsers = profiles.map((profile: any) => ({
                ...profile,
                last_sign_in_at: authMap.get(profile.id) || null
            }));
            
            data = { users: combinedUsers };
            break;

        // --- 以下為其他標準管理員功能 (保持不變) ---
        
        case 'send-test-email':
            if (!RESEND_API_KEY) throw new Error('缺少 RESEND_API_KEY');
            const testRes = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
                body: JSON.stringify({
                    from: 'Mushroom Bot <onboarding@resend.dev>', 
                    to: [RELAY_TARGET_EMAIL],
                    subject: `[測試] 蘑菇通知連線測試`,
                    html: `<p>這是一封測試信，確認系統發信功能正常。</p><p>發送時間：${new Date().toLocaleString('zh-TW', {timeZone: 'Asia/Taipei'})}</p>`,
                }),
            });
            if (!testRes.ok) throw new Error(await testRes.text());
            data = { message: '測試信已發送' };
            break;

        case 'trigger-check-now':
            if (!RESEND_API_KEY) throw new Error('缺少 RESEND_API_KEY');
            // 手動觸發，強制顯示結果 (true)
            data = await checkAndSendNotification(adminSupabaseClient, RESEND_API_KEY, true);
            break;

        case 'get-subscriber-emails': 
            const { data: subscribers, error: subErr } = await adminSupabaseClient.from('profiles').select('notification_email').not('notification_email', 'is', null).order('notification_email');
            if (subErr) throw subErr;
            data = { emails: subscribers.map((p: any) => p.notification_email).filter((e: string) => e && e.includes('@')) };
            break;

        // ★★★ 補上缺少的刪除挑戰功能 ★★★
        case 'delete-challenge':
            if (!payload.challengeId) throw new Error('缺少 challengeId');
            
            // 1. 先嘗試刪除關聯圖片 (如果有)
            const { data: challengeData } = await adminSupabaseClient
                .from('challenges')
                .select('image_url')
                .eq('id', payload.challengeId)
                .single();

            if (challengeData && challengeData.image_url) {
                try {
                    const fileName = challengeData.image_url.split('/').pop();
                    if (fileName) {
                        await adminSupabaseClient.storage.from('challenge-images').remove([fileName]);
                    }
                } catch (e) {
                    console.error('圖片刪除失敗:', e);
                }
            }

            // 2. 刪除資料庫紀錄
            const { error: delErr } = await adminSupabaseClient
                .from('challenges')
                .delete()
                .eq('id', payload.challengeId);
            
            if (delErr) throw delErr;
            data = { message: '刪除成功' };
            break;

        case 'create-user':
             const virtualEmail = `${encodeURIComponent(payload.nickname)}@pikmin.sys`;
             const { data: created, error: createErr } = await adminSupabaseClient.auth.admin.createUser({ email: virtualEmail, password: payload.password, email_confirm: true });
             if (createErr) throw createErr;
             if (created.user) {
                  const { error: profileErr } = await adminSupabaseClient.from('profiles').insert({ id: created.user.id, nickname: payload.nickname, role: payload.role });
                  if (profileErr) { await adminSupabaseClient.auth.admin.deleteUser(created.user.id); throw new Error(`建立 Profile 失敗: ${profileErr.message}`); }
                  data = created;
             }
             break;
             
        case 'update-user-role': 
            ({ data } = await adminSupabaseClient.from('profiles').update({ role: payload.role }).eq('id', payload.userId).select()); 
            break;
            
        case 'reset-user-password': 
            ({ data } = await adminSupabaseClient.auth.admin.updateUserById(payload.userId, { password: payload.password })); 
            break;
            
        case 'delete-user': 
            if (!payload.userId) throw new Error('缺少 userId'); 
            ({ data } = await adminSupabaseClient.auth.admin.deleteUser(payload.userId)); 
            break;
            
        case 'update-user-nickname': 
            const { error: pErr } = await adminSupabaseClient.from('profiles').update({ nickname: payload.newNickname }).eq('id', payload.userId);
            if (pErr) throw pErr;
            await adminSupabaseClient.from('partners').update({ name: payload.newNickname }).eq('name', payload.oldNickname);
            break;
            
        case 'get-daily-limit': 
            ({ data } = await adminSupabaseClient.from('daily_settings').select('setting_value').eq('setting_name', 'daily_signup_limit').single()); 
            break;
            
        case 'set-daily-limit': 
            ({ data } = await adminSupabaseClient.from('daily_settings').update({ setting_value: payload.value, updated_at: new Date().toISOString() }).eq('setting_name', 'daily_signup_limit').select().single()); 
            break;
            
        case 'ping': 
            break;
            
        default: throw new Error(`未知的操作: ${action}`);
    }

    return new Response(JSON.stringify({ success: true, data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});