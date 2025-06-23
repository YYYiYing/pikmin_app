// 【最終權威版】index.ts - 採用 RPC 呼叫，最穩健安全
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

    switch (action) {
      // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
      // ★  【最終修正邏輯】改為呼叫我們建立的資料庫函式 (RPC)
      // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
      case 'list-users-with-details':
        {
            const { data: profiles, error: profilesError } = await adminSupabaseClient.from('profiles').select('*');
            if (profilesError) throw profilesError;
            if (!profiles || profiles.length === 0) {
                data = { users: [] };
                break;
            }

            const userIds = profiles.map(p => p.id);

            // 步驟 3:【新方法】呼叫我們在 SQL Editor 中建立的 'get_users_signin_data' 函式
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

      // 其他 action 的邏輯保持不變
      case 'create-user':
        {
            // 【最終解決方案】移除所有額外參數，使用最標準的方式建立使用者
            const { data: created, error: createErr } = await adminSupabaseClient.auth.admin.createUser({
              email: payload.email,
              password: payload.password
              // 不再有 email_confirm: true
            });
            
            if (createErr) throw createErr;
            
            if (created.user) {
                // 手動寫入 profile 的邏輯保持不變
                const { error: profileErr } = await adminSupabaseClient.from('profiles').insert({
                    id: created.user.id,
                    nickname: payload.nickname,
                    role: payload.role
                });
                
                if (profileErr) {
                  await adminSupabaseClient.auth.admin.deleteUser(created.user.id);
                  throw new Error(`建立 Profile 失敗: ${profileErr.message}`);
                }
                data = created;
            }
        }
        break;
      // ...其他 case...
      case 'update-user-role':
        ({ data, error } = await adminSupabaseClient.from('profiles')
            .update({ role: payload.role })
            .eq('id', payload.userId)
            .select());
        break;
      case 'reset-user-password':
        ({ data, error } = await adminSupabaseClient.auth.admin.updateUserById(
          payload.userId,
          { password: payload.password }
        ));
        break;
      case 'delete-challenge':
        ({ error } = await adminSupabaseClient.from('challenges')
            .delete()
            .eq('id', payload.challengeId));
        break;
      case 'delete-user':
        if (!payload.userId) throw new Error('缺少 userId');
        ({ data, error } = await adminSupabaseClient.auth.admin.deleteUser(payload.userId));
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
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});