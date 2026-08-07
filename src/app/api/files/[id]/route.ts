import { NextRequest, NextResponse } from 'next/server';
import { supabase, isSupabaseConfigured } from '@/utils/supabase';
import { storage, isFirebaseConfigured } from '@/utils/firebase';
import { ref, deleteObject } from 'firebase/storage';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const params = await props.params;
    const { id } = params;
    const userUid = req.headers.get('x-user-uid') || new URL(req.url).searchParams.get('user_uid');

    if (!id) {
      return NextResponse.json({ error: 'file id is required' }, { status: 400 });
    }

    if (!userUid) {
      return NextResponse.json({ error: 'Unauthorized: user_uid is required' }, { status: 401 });
    }

    // 1. If not configured, simulate deletion success
    if (!isSupabaseConfigured() || !isFirebaseConfigured()) {
      console.log('Firebase or Supabase not configured. Simulating successful deletion of:', id);
      return NextResponse.json({ success: true, simulated: true }, { status: 200 });
    }

    // 2. Fetch the document record to verify ownership and get storage path
    const { data: doc, error: fetchError } = await supabase!
      .from('documents')
      .select('*')
      .eq('id', id)
      .eq('user_uid', userUid)
      .single();

    if (fetchError || !doc) {
      console.error('Supabase Doc Fetch Error during delete:', fetchError);
      return NextResponse.json({ error: 'Document not found or access denied' }, { status: 404 });
    }

    // 3. Delete file from Firebase Storage
    try {
      const storageRef = ref(storage!, doc.storage_path);
      await deleteObject(storageRef);
    } catch (storageError: any) {
      // Log storage deletion errors, but don't block DB cleanup in case file was already deleted manually
      console.warn('Firebase Storage file delete failed or did not exist:', storageError.message);
    }

    // 4. Delete file record from Supabase (triggers cascading delete for chunks)
    const { error: dbDeleteError } = await supabase!
      .from('documents')
      .delete()
      .eq('id', id)
      .eq('user_uid', userUid);

    if (dbDeleteError) {
      console.error('Supabase Document DB Delete Error:', dbDeleteError);
      return NextResponse.json({ error: 'Failed to delete file from database' }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    console.error('Delete File Endpoint Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
