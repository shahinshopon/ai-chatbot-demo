import { NextRequest, NextResponse } from 'next/server';
import { supabase, isSupabaseConfigured } from '@/utils/supabase';
import { storage, isFirebaseConfigured } from '@/utils/firebase';
import { getBatchEmbeddings, openai } from '@/utils/openai';
import { parseDocument } from '@/utils/parsers';
import { chunkText } from '@/utils/chunker';
import { ref, getBytes, uploadBytes, getDownloadURL } from 'firebase/storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow maximum serverless execution time for large files

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
    
    // AI PDF Extraction Logic: Convert Unstructured Catalog to Structured Products
    if ((!parsed.products || parsed.products.length === 0) && parsed.text && parsed.text.length > 50) {
      const textLower = parsed.text.toLowerCase();
      // Heuristic to detect unstructured catalogs
      if (textLower.includes('price') && (textLower.includes('product') || textLower.includes('sku') || textLower.includes('image url'))) {
        console.log(`Detected Unstructured Catalog. Extracting products using AI...`);
        try {
          if (openai) {
            const extractResponse = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [
                {
                  role: 'system',
                  content: 'You are a data extraction expert. Extract all products from the provided text into a clean JSON array named "products". Each product must have: "name" (string), "price" (number), "sku" (string, generate a unique random 6-digit SKU if missing e.g. SKU-123456), "image_url" (string, if present), "description" (string, merge all specifications here), "category" (string, infer if missing), "color" (string).'
                },
                {
                  role: 'user',
                  content: parsed.text.substring(0, 30000) // cap at ~30k chars
                }
              ],
              response_format: { type: 'json_object' },
              temperature: 0.1
            });
            const extractedStr = extractResponse.choices[0]?.message?.content?.trim();
            if (extractedStr) {
              const extractedJson = JSON.parse(extractedStr);
              if (extractedJson.products && Array.isArray(extractedJson.products) && extractedJson.products.length > 0) {
                console.log(`AI successfully extracted ${extractedJson.products.length} products from unstructured text.`);
                parsed.products = extractedJson.products;
              }
            }
          }
        } catch (extractErr) {
          console.error(`AI Catalog Extraction failed:`, extractErr);
        }
      }
    }
    
    // If the parsed document contains structured products, index them directly into products table
    if (parsed.products && parsed.products.length > 0) {
      console.log(`Processing Catalog with ${parsed.products.length} products`);
      const productsToProcess = parsed.products.slice(0, 100);

      // Enterprise Data Ingestion: Fetch and Host External Images to bypass Bot Protection
      if (isFirebaseConfigured()) {
        for (let item of productsToProcess) {
          if (item.image_url && item.image_url.startsWith('http') && !item.image_url.includes('firebasestorage.googleapis.com')) {
            try {
              console.log(`Pre-fetching image for SKU ${item.sku}: ${item.image_url}`);
              const response = await fetch(item.image_url, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                  'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
                }
              });
              if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const fileExt = item.image_url.split('.').pop()?.split('?')[0]?.replace(/[^a-z0-9]/gi, '') || 'jpg';
                const cleanExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(fileExt.toLowerCase()) ? fileExt.toLowerCase() : 'jpg';
                const storagePath = `users/${userUid}/catalog_images/${Date.now()}_${item.sku}.${cleanExt}`;
                const storageRef = ref(storage!, storagePath);
                
                await uploadBytes(storageRef, buffer, {
                  contentType: `image/${cleanExt === 'jpg' ? 'jpeg' : cleanExt}`
                });
                
                const downloadUrl = await getDownloadURL(storageRef);
                console.log(`Successfully hosted image for SKU ${item.sku}: ${downloadUrl}`);
                item.image_url = downloadUrl; // Mutate the object before insertion
                
                // Auto Image Captioning for Data Enrichment
                try {
                  console.log(`Extracting visual keywords for SKU ${item.sku}...`);
                  if (openai) {
                    const visionResponse = await openai.chat.completions.create({
                      model: 'gpt-4o-mini',
                      messages: [
                        {
                          role: 'user',
                          content: [
                            { type: 'text', text: 'Describe the product in this image using 5-15 comma-separated visual keywords (e.g. color, pattern, style, item type). Output ONLY the keywords.' },
                            { type: 'image_url', image_url: { url: downloadUrl, detail: 'low' } }
                          ] as any[]
                        }
                      ],
                      max_tokens: 50,
                      temperature: 0.1
                    });
                    const visualKeywords = visionResponse.choices[0]?.message?.content?.trim();
                    if (visualKeywords) {
                      item.description = item.description 
                        ? `${item.description}. Visuals: ${visualKeywords}` 
                        : `Visuals: ${visualKeywords}`;
                      console.log(`Enriched SKU ${item.sku} with visuals: ${visualKeywords}`);
                    }
                  }
                } catch (visionErr) {
                  console.error(`Failed to caption image for SKU ${item.sku}:`, visionErr);
                }
              } else {
                console.warn(`Failed to fetch image for SKU ${item.sku}. Status: ${response.status}`);
              }
            } catch (err) {
              console.error(`Error pre-fetching image for SKU ${item.sku}:`, err);
            }
          }
        }
      }

      // Construct text representation for each product
      const textsToEmbed = productsToProcess.map((item: any) => {
        return `Name: ${item.name} | SKU: ${item.sku} | Category: ${item.category || 'N/A'} | Price: ${item.price} | Color: ${item.color || 'N/A'} | Size: ${item.size || 'N/A'} | Description: ${item.description || 'N/A'}`;
      });

      // Generate all embeddings in high-speed batches
      const embeddings = await getBatchEmbeddings(textsToEmbed);

      const productInserts = productsToProcess.map((item: any, i: number) => ({
        document_id: docId,
        user_uid: userUid,
        sku: item.sku,
        name: item.name,
        price: item.price,
        currency: item.currency || null,
        category: item.category || null,
        color: item.color || null,
        size: item.size || null,
        in_stock: item.inStock !== false,
        description: item.description || null,
        image_url: item.image_url || null,
        product_url: item.product_url || null,
        embedding: embeddings[i],
      }));

      // Insert products in batches of 50 to prevent Supabase statement timeout
      for (let i = 0; i < productInserts.length; i += 50) {
        const batch = productInserts.slice(i, i + 50);
        const { error: productInsertError } = await supabase!
          .from('products')
          .insert(batch);

        if (productInsertError) {
          console.error('Supabase Catalog Ingestion Error:', productInsertError);
          throw new Error('Failed to index product catalog items in database');
        }
      }

      // Update status to indexed
      await supabase!
        .from('documents')
        .update({ status: 'indexed' })
        .eq('id', docId);

      return NextResponse.json({
        success: true,
        productsCount: productsToProcess.length,
      }, { status: 200 });
    }

    if (!parsed.text || parsed.text.trim() === '') {
      throw new Error('Document contains no extractable text');
    }

    // 5. Chunk the plain text
    let chunks = chunkText(parsed.text);

    // Limit chunks to 80 (approx 80k-120k words) to guarantee completion
    if (chunks.length > 80) {
      console.warn(`Truncating document chunks from ${chunks.length} to 80 to prevent Serverless execution timeout.`);
      chunks = chunks.slice(0, 80);
    }

    if (chunks.length === 0) {
      throw new Error('No chunks could be generated from the document text');
    }

    // 6. Generate embeddings and insert chunks in high-speed batches
    const BATCH_SIZE = 30;
    
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batchChunks = chunks.slice(i, i + BATCH_SIZE);
      const batchEmbeddings = await getBatchEmbeddings(batchChunks);

      const chunkInserts = batchChunks.map((chunk, j) => {
        const chunkIndex = i + j;
        return {
          document_id: docId,
          user_uid: userUid,
          chunk_text: chunk,
          embedding: batchEmbeddings[j],
          page: parsed.pageCount > 1 ? chunkIndex + 1 : 1,
          metadata: {
            index: chunkIndex,
            total_chunks: chunks.length,
            filename: doc.filename,
          },
        };
      });

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
