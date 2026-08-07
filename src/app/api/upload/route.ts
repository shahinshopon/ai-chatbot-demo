import { NextRequest, NextResponse } from 'next/server';
import { supabase, isSupabaseConfigured } from '@/utils/supabase';
import { storage, isFirebaseConfigured } from '@/utils/firebase';
import { ref, uploadBytes } from 'firebase/storage';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const userUid = req.headers.get('x-user-uid') || (formData.get('user_uid') as string);

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!userUid) {
      return NextResponse.json({ error: 'Unauthorized: No user UID provided' }, { status: 401 });
    }

    // Validation: Max size 20MB
    const MAX_SIZE = 20 * 1024 * 1024; // 20 MB
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: 'File size exceeds maximum limit of 20MB' },
        { status: 400 }
      );
    }

    // Validation: File extensions (PDF, DOCX, TXT, CSV, JSON)
    const allowedExtensions = ['pdf', 'docx', 'txt', 'csv', 'json'];
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!extension || !allowedExtensions.includes(extension)) {
      return NextResponse.json(
        { error: `Unsupported file type: .${extension}. Only PDF, DOCX, TXT, CSV, and JSON are allowed.` },
        { status: 400 }
      );
    }

    const filename = file.name;
    const buffer = Buffer.from(await file.arrayBuffer());

    // 1. If Firebase & Supabase are NOT configured, we enter beautiful simulation mode
    if (!isFirebaseConfigured() || !isSupabaseConfigured()) {
      console.log('Firebase or Supabase not configured. Simulating successful upload for:', filename);
      
      const simulatedDoc = {
        id: 'sim_' + Math.random().toString(36).substring(2, 15),
        user_uid: userUid,
        filename,
        storage_path: `users/${userUid}/${Date.now()}_${filename}`,
        file_size: file.size,
        status: 'uploaded',
        uploaded_at: new Date().toISOString(),
      };

      return NextResponse.json(simulatedDoc, { status: 200 });
    }

    // 2. Upload original file to Firebase Storage
    const storagePath = `users/${userUid}/${Date.now()}_${filename}`;
    const storageRef = ref(storage!, storagePath);
    await uploadBytes(storageRef, buffer, {
      contentType: file.type,
    });

    // 3. Store document record in Supabase
    const { data: docData, error: docError } = await supabase!
      .from('documents')
      .insert({
        user_uid: userUid,
        filename,
        storage_path: storagePath,
        file_size: file.size,
        status: 'uploaded',
      })
      .select()
      .single();

    if (docError) {
      console.error('Supabase Document Insert Error:', docError);
      return NextResponse.json({ error: 'Database storage failed' }, { status: 500 });
    }

    return NextResponse.json(docData, { status: 200 });
  } catch (error: any) {
    console.error('Upload Endpoint Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
