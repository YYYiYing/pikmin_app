// 【偵錯版】 - 以您可正常執行的版本為基礎，僅加上日誌
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. 安全守門員 (邏輯不變)
    const userSupabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('PUBLIC_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );
    const { data: { user } } = await userSupabaseClient.auth.getUser();
    if (!user) throw new Error('無效的使用者或 Token');

    const { data: profile, error: profileError } = await userSupabaseClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError || profile?.role !== '管理者') {
      return new Response(JSON.stringify({ error: '權限不足' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 403,
      });
    }

    // 2. 執行管理員操作
    const adminSupabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SECRET_KEY') ?? ''
    );
    
    const { action, payload } = JSON.parse(await req.text());
    let data: unknown = null;
    let error = null;

    // ★【偵錯日誌 1】顯示收到的 action 和 payload
    console.log(`[DEBUG] Received action: "${action}" with payload:`, JSON.stringify(payload));

    switch (action) {
      case 'list-users-with-details':
        {
            const { data: profiles, error: profilesError } = await adminSupabaseClient.from('profiles').select('*');
            if (profilesError) throw profilesError;
            if (!profiles || profiles.length === 0) {
                data = { users: [] };
                break;
            }
            const userIds = profiles.map(p => p.id);
            const { data: authData, error: rpcError } = await adminSupabaseClient
                .rpc('get_users_signin_data', { user_ids: userIds });
            if (rpcError) {
                console.error("RPC call failed:", rpcError);
                throw rpcError;
            }
            const authMap = new Map(authData.map((u: any) => [u.id, u.last_sign_in_at]));
            const combinedUsers = profiles.map(profile => ({
                ...profile,
                last_sign_in_at: authMap.get(profile.id) || null
            }));
            data = { users: combinedUsers };
        }
        break;

      case 'invite-user':
        {
            // 使用 Supabase 官方推薦的邀請流程
            const { data: invited, error: inviteErr } = await adminSupabaseClient.auth.admin.inviteUserByEmail(
              payload.email, // 從前端傳來的真實 email
              {
                data: { 
                  nickname: payload.nickname, // 您可以將暱稱等資訊放在 metadata 中
                  role: payload.role 
                }
              }
            );

            if (inviteErr) throw inviteErr;

            // 這裡可以手動更新 profiles 表，因為觸發器可能在使用者接受邀請後才執行
            if (invited.user) {
              const { error: profileErr } = await adminSupabaseClient.from('profiles').update({
                nickname: payload.nickname,
                role: payload.role
              }).eq('id', invited.user.id);
              
              if (profileErr) {
                 // 這裡可以選擇是否要刪除邀請，或只是記錄錯誤
                 console.error("邀請後更新 profile 失敗:", profileErr);
              }
            }
            data = invited;
        }
        break;

      case 'update-user-role':
        ({ data, error } = await adminSupabaseClient.from('profiles')
            .update({ role: payload.role })
            .eq('id', payload.userId)
            .select());
        break;

      case 'reset-user-password': // ★★★ 增加日誌 ★★★
        {
            console.log(`[DEBUG] Entering 'reset-user-password' for userId: ${payload.userId}`);
            const result = await adminSupabaseClient.auth.admin.updateUserById(
                payload.userId,
                { password: payload.password }
            );
            data = result.data;
            error = result.error;
            // 顯示執行結果，無論成功或失敗
            console.log('[DEBUG] updateUserById result:', { data, error });
        }
        break;

      case 'delete-challenge':
        ({ error } = await adminSupabaseClient.from('challenges')
            .delete()
            .eq('id', payload.challengeId));
        break;

      case 'delete-user': // ★★★ 增加日誌 ★★★
        {
            if (!payload.userId) throw new Error('缺少 userId');
            console.log(`[DEBUG] Entering 'delete-user' for userId: ${payload.userId}`);
            const result = await adminSupabaseClient.auth.admin.deleteUser(payload.userId);
            data = result.data;
            error = result.error;
            // 顯示執行結果，無論成功或失敗
            console.log('[DEBUG] deleteUser result:', { data, error });
        }
        break;

      case 'ping':
        break;
        
      default:
        throw new Error(`未知的操作: ${action}`);
    }

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err) {
    // ★【偵錯日誌】捕捉並顯示所有拋出的錯誤
    console.error('[FATAL ERROR]', err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});