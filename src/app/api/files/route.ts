import { NextRequest, NextResponse } from 'next/server';
import { supabase, isSupabaseConfigured } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userUid = req.headers.get('x-user-uid') || searchParams.get('user_uid');

    if (!userUid) {
      return NextResponse.json({ error: 'Unauthorized: user_uid is required' }, { status: 401 });
    }

    // 1. If Supabase is not configured, we return mock uploaded files stored in the frontend or default simulation files
    if (!isSupabaseConfigured()) {
      return NextResponse.json({
        files: [],
        simulated: true,
      }, { status: 200 });
    }

    // 2. Fetch from Supabase
    const { data: files, error } = await supabase!
      .from('documents')
      .select('*')
      .eq('user_uid', userUid)
      .order('uploaded_at', { ascending: false });

    if (error) {
      console.error('Supabase GET files error:', error);
      return NextResponse.json({ error: 'Failed to retrieve files' }, { status: 500 });
    }

    return NextResponse.json({ files }, { status: 200 });
  } catch (error: any) {
    console.error('Get Files Endpoint Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
