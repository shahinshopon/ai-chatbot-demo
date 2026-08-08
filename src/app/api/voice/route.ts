// src/app/api/voice/route.ts
import { NextResponse } from 'next/server';
import { openai } from '@/utils/openai';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: 'Audio file is required' }, { status: 400 });
    }
    // If OpenAI is not configured, return mock response for simulation mode
    if (!openai) {
      return NextResponse.json({ text: 'Mock transcription', language: 'en' });
    }
    // Convert Blob to File if necessary
    const audioFile = file instanceof File ? file : new File([file], 'voice.webm');
    const transcription = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: audioFile,
    });
    return NextResponse.json({ text: transcription.text, language: (transcription as any).language ?? null });
  } catch (error: any) {
    console.error('Voice transcription error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
