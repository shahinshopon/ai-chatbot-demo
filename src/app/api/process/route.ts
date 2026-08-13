import { NextRequest, NextResponse } from 'next/server';
import { supabase, isSupabaseConfigured } from '@/utils/supabase';
import { storage, isFirebaseConfigured } from '@/utils/firebase';
import { getEmbedding, openai } from '@/utils/openai';
import { parseDocument } from '@/utils/parsers';
import { chunkText } from '@/utils/chunker';
import { ref, getBytes } from 'firebase/storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow maximum serverless execution time for large files

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getVisualDescriptionWithRetry(
  openaiClient: any,
  imageUrl: string,
  name: string,
  retries = 3,
  baseDelay = 500
): Promise<string | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const visResponse = await openaiClient.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Analyze this product image. Describe its key visual characteristics (colors, styles, designs, patterns, types) in a single concise sentence of under 15 words. Be extremely specific about colors and style (e.g., "pastel yellow, pink, and light blue Nike Air Force style sneakers"). Do not include other text.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl
                }
              }
            ]
          }
        ],
        max_tokens: 50,
      });

      return visResponse.choices[0]?.message?.content?.trim() || null;
    } catch (err: any) {
      const isRateLimit = err?.status === 429 || (err?.message && err.message.includes('rate_limit_exceeded'));
      if (isRateLimit && attempt < retries) {
        let delayMs = baseDelay * Math.pow(2, attempt);
        if (err.headers) {
          // Attempt to extract the retry duration from openai headers if present
          const retryAfterMs = err.headers.get?.('retry-after-ms') || err.headers.get?.('Retry-After-Ms');
          if (retryAfterMs) {
            delayMs = parseInt(retryAfterMs, 10) + 100;
          } else {
            const retryAfterSec = err.headers.get?.('retry-after') || err.headers.get?.('Retry-After');
            if (retryAfterSec) {
              delayMs = (parseInt(retryAfterSec, 10) * 1000) + 100;
            }
          }
        }
        console.warn(`[Rate Limit 429] for "${name}" (Attempt ${attempt}/${retries}). Retrying in ${delayMs}ms...`);
        await sleep(delayMs);
      } else {
        throw err;
      }
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  let docId = '';
  let userUid = '';

  try {
    const body = await req.json();
    docId = body.document_id;
    userUid = req.headers.get('x-user-uid') || body.user_uid;

    if (!docId) {
      return NextResponse.json({ error: 'document_id is required' }, { status: 400 });
    }

    if (!userUid) {
      return NextResponse.json({ error: 'Unauthorized: user_uid is required' }, { status: 401 });
    }

    // 1. If Firebase or Supabase is not configured, we simulate processing immediately
    if (!isFirebaseConfigured() || !isSupabaseConfigured()) {
      console.log('Firebase or Supabase not configured. Simulating processing for doc:', docId);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return NextResponse.json({ success: true, chunksCount: 12, simulated: true }, { status: 200 });
    }

    // 2. Fetch the document record from Supabase to get the storage path and filename
    const { data: doc, error: docError } = await supabase!
      .from('documents')
      .select('*')
      .eq('id', docId)
      .eq('user_uid', userUid)
      .single();

    if (docError || !doc) {
      console.error('Supabase Doc Fetch Error:', docError);
      return NextResponse.json({ error: 'Document not found or access denied' }, { status: 404 });
    }

    // 3. If the file was uploaded as simulated by the frontend (e.g. large files bypass), simulate it!
    if (doc.storage_path.startsWith('simulated/')) {
      console.log('Document was uploaded via simulation. Simulating processing for doc:', docId);
      
      await new Promise((resolve) => setTimeout(resolve, 1500));

      await supabase!
        .from('documents')
        .update({ status: 'indexed' })
        .eq('id', docId);

      return NextResponse.json({ success: true, chunksCount: 12, simulated: true }, { status: 200 });
    }



    // Update document status to processing
    await supabase!
      .from('documents')
      .update({ status: 'processing' })
      .eq('id', docId);

    // 3. Download the file from Firebase Storage
    const storageRef = ref(storage!, doc.storage_path);
    const fileArrayBuffer = await getBytes(storageRef);
    const fileBuffer = Buffer.from(fileArrayBuffer);

    // 4. Parse document to plain text
    const parsed = await parseDocument(fileBuffer, doc.filename);
    
    // If the parsed document contains structured products, index them directly into products table (Phase 2 Catalog Ingestion)
    if (parsed.products && parsed.products.length > 0) {
      console.log(`Processing Catalog with ${parsed.products.length} products`);
      const productInserts = [];

      for (let i = 0; i < parsed.products.length; i++) {
        const item = parsed.products[i];
        let finalDescription = item.description || '';

        // Generate concise visual description on-the-fly with rate-limit resilient retries
        if (item.image_url && openai) {
          try {
            console.log(`Generating on-the-fly visual description for catalog item: ${item.name}`);
            const visText = await getVisualDescriptionWithRetry(openai, item.image_url, item.name);
            if (visText) {
              finalDescription = `${finalDescription} [Visual description: ${visText}]`.trim();
              console.log(`Successfully generated Visual Description for "${item.name}": "${visText}"`);
            }
            
            // Add a tiny voluntary 100ms delay to space out visual description calls nicely and protect the TPM quota
            await sleep(100);
          } catch (visErr) {
            console.error(`Failed to generate visual description for ${item.name} after retries:`, visErr);
          }
        }
        
        // Build descriptive textual block for generating semantic vector representation
        const textToEmbed = `Name: ${item.name} | SKU: ${item.sku} | Category: ${item.category || 'N/A'} | Price: $${item.price} | Color: ${item.color || 'N/A'} | Size: ${item.size || 'N/A'} | Description: ${finalDescription || 'N/A'}`;
        const embedding = await getEmbedding(textToEmbed);

        productInserts.push({
          document_id: docId,
          user_uid: userUid,
          sku: item.sku,
          name: item.name,
          price: item.price,
          currency: item.currency || 'USD',
          category: item.category || null,
          color: item.color || null,
          size: item.size || null,
          in_stock: item.inStock !== false,
          description: finalDescription || null,
          image_url: item.image_url || null,
          product_url: item.product_url || null,
          embedding: embedding,
        });
      }

      const { error: productInsertError } = await supabase!
        .from('products')
        .insert(productInserts);

      if (productInsertError) {
        console.error('Supabase Catalog Ingestion Error:', productInsertError);
        throw new Error('Failed to index product catalog items in database');
      }

      // Update status to indexed
      await supabase!
        .from('documents')
        .update({ status: 'indexed' })
        .eq('id', docId);

      return NextResponse.json({
        success: true,
        productsCount: parsed.products.length,
      }, { status: 200 });
    }

    if (!parsed.text || parsed.text.trim() === '') {
      throw new Error('Document contains no extractable text');
    }

    // 5. Chunk the plain text
    let chunks = chunkText(parsed.text);

    // Limit chunks to 80 (approx 80k-120k words) to guarantee it finishes before Vercel's 60s serverless timeout
    if (chunks.length > 80) {
      console.warn(`Truncating document chunks from ${chunks.length} to 80 to prevent Serverless execution timeout.`);
      chunks = chunks.slice(0, 80);
    }

    if (chunks.length === 0) {
      throw new Error('No chunks could be generated from the document text');
    }

    // 6. Generate embeddings and insert chunks in batches to avoid Vercel/Supabase timeouts
    const BATCH_SIZE = 20;
    
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batchChunks = chunks.slice(i, i + BATCH_SIZE);
      const chunkInserts = [];
      
      // We process embeddings sequentially within the batch to respect rate limits,
      // or we could use Promise.all if the provider handles concurrency well.
      // Doing it sequentially in small batches is safest for free tier limits.
      for (let j = 0; j < batchChunks.length; j++) {
        const chunkIndex = i + j;
        const chunk = batchChunks[j];
        const embedding = await getEmbedding(chunk);

        chunkInserts.push({
          document_id: docId,
          user_uid: userUid,
          chunk_text: chunk,
          embedding: embedding,
          page: parsed.pageCount > 1 ? chunkIndex + 1 : 1,
          metadata: {
            index: chunkIndex,
            total_chunks: chunks.length,
            filename: doc.filename,
          },
        });
      }

      // Insert this batch into Supabase pgvector table
      const { error: insertError } = await supabase!
        .from('document_chunks')
        .insert(chunkInserts);

      if (insertError) {
        console.error('Supabase Chunks Insertion Error (Batch):', insertError);
        throw new Error('Failed to index document chunks in database');
      }
    }

    // Update status to indexed
    await supabase!
      .from('documents')
      .update({ status: 'indexed' })
      .eq('id', docId);

    return NextResponse.json({
      success: true,
      chunksCount: chunks.length,
    }, { status: 200 });

  } catch (error: any) {
    console.error('Processing Endpoint Error:', error);
    
    // Attempt to set document status to failed if DB client is available
    if (isSupabaseConfigured() && docId) {
      await supabase!
        .from('documents')
        .update({ status: 'failed' })
        .eq('id', docId);
    }

    return NextResponse.json({
      error: error.message || 'Failed to process document',
    }, { status: 500 });
  }
}
