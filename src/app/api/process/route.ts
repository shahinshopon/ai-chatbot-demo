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
    const action = body.action || 'full'; // 'init', 'batch_products', 'batch_chunks', 'complete', 'full'

    if (!docId) return NextResponse.json({ error: 'document_id is required' }, { status: 400 });
    if (!userUid) return NextResponse.json({ error: 'Unauthorized: user_uid is required' }, { status: 401 });

    // Simulation mode
    if (!isFirebaseConfigured() || !isSupabaseConfigured()) {
      console.log('Simulation mode active for doc:', docId);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return NextResponse.json({ success: true, chunksCount: 12, simulated: true, products: [], chunks: [] }, { status: 200 });
    }

    // ACTION: COMPLETE
    if (action === 'complete') {
      await supabase!.from('documents').update({ status: 'indexed' }).eq('id', docId);
      return NextResponse.json({ success: true });
    }

    // ACTION: BATCH_PRODUCTS
    if (action === 'batch_products') {
      const productsToProcess = body.products || [];
      if (productsToProcess.length === 0) return NextResponse.json({ success: true, productsCount: 0 });

      // Enterprise Data Ingestion: Fetch and Host External Images to bypass Bot Protection
      for (let item of productsToProcess) {
        if (item.image_url && item.image_url.startsWith('http') && !item.image_url.includes('firebasestorage.googleapis.com')) {
          try {
            console.log(`Pre-fetching image for SKU ${item.sku}: ${item.image_url}`);
            const response = await fetch(item.image_url, {
              headers: {
                'User-Agent': 'Mozilla/5.0',
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
              
              await uploadBytes(storageRef, buffer, { contentType: `image/${cleanExt === 'jpg' ? 'jpeg' : cleanExt}` });
              const downloadUrl = await getDownloadURL(storageRef);
              console.log(`Successfully hosted image for SKU ${item.sku}: ${downloadUrl}`);
              item.image_url = downloadUrl;
              
              // Auto Image Captioning
              try {
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
                  }
                }
              } catch (visionErr) {
                console.error(`Failed to caption image for SKU ${item.sku}:`, visionErr);
              }
            }
          } catch (err) {
            console.error(`Error pre-fetching image for SKU ${item.sku}:`, err);
          }
        }
      }

      const textsToEmbed = productsToProcess.map((item: any) => {
        return `Name: ${item.name} | SKU: ${item.sku} | Category: ${item.category || 'N/A'} | Price: ${item.price} | Color: ${item.color || 'N/A'} | Size: ${item.size || 'N/A'} | Description: ${item.description || 'N/A'}`;
      });

      const embeddings = await getBatchEmbeddings(textsToEmbed);
      const productInserts = productsToProcess.map((item: any, i: number) => ({
        document_id: docId,
        user_uid: userUid,
        sku: item.sku || `SKU-${Math.random().toString(36).substring(7).toUpperCase()}`,
        name: item.name || 'Unnamed Product',
        price: typeof item.price === 'string' ? parseFloat(item.price.replace(/[^0-9.]/g, '')) || 0 : (typeof item.price === 'number' ? item.price : 0),
        currency: item.currency || '',
        category: item.category || null,
        color: item.color || null,
        size: item.size || null,
        in_stock: item.inStock !== false,
        description: item.description || null,
        image_url: item.image_url || null,
        product_url: item.product_url || null,
        embedding: embeddings[i],
      }));

      const { error: productInsertError } = await supabase!.from('products').insert(productInserts);
      if (productInsertError) throw new Error(`Failed to index product batch: ${productInsertError.message || JSON.stringify(productInsertError)}`);

      return NextResponse.json({ success: true, productsCount: productsToProcess.length });
    }

    // ACTION: BATCH_CHUNKS
    if (action === 'batch_chunks') {
      const chunksToProcess = body.chunks || [];
      const startIndex = body.startIndex || 0;
      const pageCount = body.pageCount || 1;
      const filename = body.filename || 'Unknown';
      
      if (chunksToProcess.length === 0) return NextResponse.json({ success: true, chunksCount: 0 });

      const batchEmbeddings = await getBatchEmbeddings(chunksToProcess);
      const chunkInserts = chunksToProcess.map((chunk: string, j: number) => {
        const chunkIndex = startIndex + j;
        return {
          document_id: docId,
          user_uid: userUid,
          chunk_text: chunk,
          embedding: batchEmbeddings[j],
          page: pageCount > 1 ? chunkIndex + 1 : 1,
          metadata: { index: chunkIndex, filename },
        };
      });

      const { error: insertError } = await supabase!.from('document_chunks').insert(chunkInserts);
      if (insertError) throw new Error(`Failed to index chunk batch: ${insertError.message || JSON.stringify(insertError)}`);

      return NextResponse.json({ success: true, chunksCount: chunksToProcess.length });
    }

    // ACTION: INIT (Parse the document and return items for client to batch)
    // Fetch document record
    const { data: doc, error: docError } = await supabase!
      .from('documents')
      .select('*')
      .eq('id', docId)
      .single();

    if (docError || !doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    if (doc.storage_path.startsWith('simulated/')) {
      await supabase!.from('documents').update({ status: 'indexed' }).eq('id', docId);
      return NextResponse.json({ success: true, products: [], chunks: [] });
    }

    await supabase!.from('documents').update({ status: 'processing' }).eq('id', docId);

    const storageRef = ref(storage!, doc.storage_path);
    const fileArrayBuffer = await getBytes(storageRef);
    const parsed = await parseDocument(Buffer.from(fileArrayBuffer), doc.filename);

    // AI PDF Extraction Logic
    if ((!parsed.products || parsed.products.length === 0) && parsed.text && parsed.text.length > 50) {
      const textLower = parsed.text.toLowerCase();
      if (textLower.includes('price') && (textLower.includes('product') || textLower.includes('sku') || textLower.includes('image url'))) {
        try {
          if (openai) {
            const extractResponse = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: 'You are a data extraction expert. Extract all products into a JSON array named "products" with: name, price (numeric only), currency (extract any currency word/symbol located next to the price, e.g. "taka", "BDT", "USD". If none found, leave empty ""), sku (generate 6-digit string if missing), image_url, description, category, color.' },
                { role: 'user', content: parsed.text.substring(0, 30000) }
              ],
              response_format: { type: 'json_object' },
              temperature: 0.1
            });
            const extractedStr = extractResponse.choices[0]?.message?.content?.trim();
            if (extractedStr) {
              const extractedJson = JSON.parse(extractedStr);
              if (extractedJson.products && Array.isArray(extractedJson.products)) {
                parsed.products = extractedJson.products;
              }
            }
          }
        } catch (e) {
          console.error('AI PDF Extraction Error:', e);
        }
      }
    }

    // If we have products, return them to the client
    if (parsed.products && parsed.products.length > 0) {
      return NextResponse.json({
        success: true,
        type: 'products',
        products: parsed.products,
      });
    }

    // Otherwise, generate chunks and return them to the client
    if (!parsed.text || parsed.text.trim() === '') throw new Error('No text extractable');
    const chunks = chunkText(parsed.text);

    return NextResponse.json({
      success: true,
      type: 'chunks',
      chunks: chunks,
      pageCount: parsed.pageCount,
      filename: doc.filename
    });

  } catch (error: any) {
    console.error('Processing Endpoint Error:', error);
    if (isSupabaseConfigured() && docId) {
      await supabase!.from('documents').update({ status: 'failed' }).eq('id', docId);
    }
    return NextResponse.json({ error: error.message || 'Failed to process document' }, { status: 500 });
  }
}
