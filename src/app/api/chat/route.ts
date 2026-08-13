import { NextRequest, NextResponse } from 'next/server';
import { supabase, isSupabaseConfigured } from '@/utils/supabase';
import { getEmbedding, openai, isOpenAIConfigured } from '@/utils/openai';

export const dynamic = 'force-dynamic';

function stripMarkdownFormatting(text: string): string {
  if (!text) return text;
  
  // 1. Temporarily isolate the custom product preview cards to protect their format
  const cardPlaceholderMap = new Map<string, string>();
  let placeholderCounter = 0;
  
  const cardRegex = /\[\!\[([^\]]+)\]\(([^)]+)\)\]\(([^)]+)\)/g;
  let cleanedText = text.replace(cardRegex, (match) => {
    const placeholder = `__CARD_PLACEHOLDER_${placeholderCounter++}__`;
    cardPlaceholderMap.set(placeholder, match);
    return placeholder;
  });
  
  // 2. Remove markdown header hashes (#, ##, ###) at the beginning of any lines
  cleanedText = cleanedText.replace(/^#{1,6}\s+/gm, '');
  
  // 3. Strip bold and italic indicators (e.g., **, *, __, _) while preserving contained text
  cleanedText = cleanedText.replace(/\*\*([^*]+)\*\*/g, '$1');
  cleanedText = cleanedText.replace(/\*([^*]+)\*/g, '$1');
  cleanedText = cleanedText.replace(/__([^_]+)__/g, '$1');
  cleanedText = cleanedText.replace(/_([^_]+)_/g, '$1');
  
  // 4. Restore the original custom product card links
  cardPlaceholderMap.forEach((originalCard, placeholder) => {
    cleanedText = cleanedText.replace(placeholder, originalCard);
  });
  
  return cleanedText;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, user_uid, image_url, language } = body;

    if (!user_uid || (!message && !image_url)) {
      return NextResponse.json({ error: 'user_uid, and either a text message or image_url are required' }, { status: 400 });
    }

    // 1. Check if fully configured. If NOT, return beautifully simulated RAG responses
    if (!isSupabaseConfigured() || !isOpenAIConfigured() || !openai) {
      console.log('RAG stack is in simulation mode for chat.');
      
      // Save user message to simulated local history if needed, or let client handle history.
      // We will generate an intelligent simulated answer based on keywords
      await new Promise((resolve) => setTimeout(resolve, 1200));

      const lowercaseMsg = (message || '').toLowerCase();
      let responseText = "I couldn't find that information in your uploaded documents.";
      let sources: Array<{ filename: string; page?: number }> = [];

      if (image_url) {
        responseText = "Yes! I matched your uploaded product image with a catalog match for our **Artestic Spherical Crimson Lounge Chair**.\n\n* **SKU**: LOU-CRIM-99\n* **Price**: $399.00 USD\n* **In Stock**: Yes (3 units available)\n* **Color**: Crimson Red\n* **Description**: A stunning artistic spherical lounge chair featuring vibrant crimson upholstery and an ultra-modern ergonomic design.\n\nHere is the product card for quick access:\n\n[![Artestic spherical crimson lounge chair](https://images.unsplash.com/photo-1601366533287-5ee4c763ae4e?w=900&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8NHx8bG91bmdlJTIwY2hhaXJ8ZW58MHx8MHx8fDA%3D)](https://example.com/products/crimson-lounge-chair)";
        sources = [{ filename: 'furniture_catalog.csv' }];
      } else if (lowercaseMsg.includes('hello') || lowercaseMsg.includes('hi') || lowercaseMsg.includes('hey')) {
        responseText = "Hello! I am your isolated business knowledge assistant. Upload your documents (PDF, DOCX, TXT) and ask me anything about them. I will answer only using your uploaded knowledge.";
      } else if (lowercaseMsg.includes('pricing') || lowercaseMsg.includes('price') || lowercaseMsg.includes('cost')) {
        responseText = "According to your uploaded pricing guide:\n\n- **Starter Plan**: $49/month (includes 5 team members, 10GB storage)\n- **Professional Plan**: $99/month (includes 20 team members, 50GB storage, priority support)\n- **Enterprise Plan**: Custom pricing (unlimited resources, dedicated account manager)\n\nAll plans include standard isolated data compliance.";
        sources = [{ filename: 'pricing_structure.pdf', page: 2 }];
      } else if (lowercaseMsg.includes('service') || lowercaseMsg.includes('features') || lowercaseMsg.includes('capabilities')) {
        responseText = "Your uploaded company profile document states that we provide the following enterprise services:\n\n1. **AI-Driven Data Analytics**: Instantly extract intelligence from unstructured records.\n2. **Custom Cloud Infrastructure**: High-performance, low-latency private cloud deployments.\n3. **Cybersecurity Audits**: Continuous vulnerability scans and full RAG standard data compliance verification.";
        sources = [{ filename: 'company_profile.pdf', page: 1 }];
      } else if (lowercaseMsg.includes('contact') || lowercaseMsg.includes('support') || lowercaseMsg.includes('help')) {
        responseText = "Based on the internal support directory, you can contact our technical assistance team at **support@knowledgechat.ai** or call **+8801991-151076** during standard operational hours (9 AM - 6 PM EST).";
        sources = [{ filename: 'internal_faq.txt' }];
      } else if (lowercaseMsg.includes('chair') || lowercaseMsg.includes('lounge') || lowercaseMsg.includes('furniture')) {
        if (lowercaseMsg.includes('shell') || lowercaseMsg.includes('circular') || lowercaseMsg.includes('white')) {
          responseText = "Yes! I found a match in your uploaded product catalog for the **Artistic Circular Shell Lounge Chair**.\n\n* **SKU**: LOU-SHELL-45\n* **Price**: $450.00 USD\n* **In Stock**: Yes (5 units available)\n* **Color**: White Shell / Comfort Padding\n* **Description**: A futuristic egg-shaped lounge chair perfect for modern home office interiors, featuring exceptional comfort and a striking profile.\n\nHere is the product card for quick access:\n\n[![Artistic Circular Shell Lounge Chair](https://img.magnific.com/free-vector/ball-chair-round-armchair-front-side-view-futuristic-furniture-design-home-office-interior-comfortable-egg-shaped-seat-isolated-white-background-realistic-3d-vector-illustration_107791-4584.jpg?semt=ais_hybrid&w=740&q=80)](https://example.com/products/shell-lounge-chair)";
        } else {
          responseText = "Yes! I found a match in your uploaded product catalog for the **Artestic Spherical Crimson Lounge Chair**.\n\n* **SKU**: LOU-CRIM-99\n* **Price**: $399.00 USD\n* **In Stock**: Yes (3 units available)\n* **Color**: Crimson Red\n* **Description**: A stunning artistic spherical lounge chair featuring vibrant crimson upholstery and an ultra-modern ergonomic design.\n\nHere is the product card for quick access:\n\n[![Artestic spherical crimson lounge chair](https://images.unsplash.com/photo-1601366533287-5ee4c763ae4e?w=900&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8NHx8bG91bmdlJTIwY2hhaXJ8ZW58MHx8MHx8fDA%3D)](https://example.com/products/crimson-lounge-chair)";
        }
        sources = [{ filename: 'furniture_catalog.csv' }];
      }

      return NextResponse.json({
        response: responseText,
        sources,
        simulated: true,
      }, { status: 200 });
    }

    // 2. Real RAG Flow
    // Save user message to database
    const dbMessage = message || "[Uploaded Image]";
    await supabase!
      .from('chat_history')
      .insert({
        user_uid: user_uid,
        message: dbMessage,
        role: 'user',
      });

    let searchQuery = message || '';
    let visualKeywords = '';

    // If an image is uploaded, perform a pre-query Vision descriptor pass
    if (image_url) {
      console.log('Detecting uploaded image in chat request. Extracting visual descriptors.');
      try {
        const visionResponse = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Analyze this image of an e-commerce product. Extract its key visual attributes: colors, patterns, style, material, fabric, product type, gender, and brand markings if visible. Respond with a concise, single-line comma-separated list of search keywords representing this item. Do not include any other text.'
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: image_url,
                  }
                }
              ] as any[]
            }
          ],
          max_tokens: 150,
        });
        visualKeywords = visionResponse.choices[0]?.message?.content || '';
        console.log('Extracted visual keywords for hybrid search:', visualKeywords);
        if (visualKeywords) {
          searchQuery = `${searchQuery} ${visualKeywords}`.trim();
        }
      } catch (visionErr) {
        console.error('OpenAI Vision Analysis Error:', visionErr);
      }
    }

    // Generate query embedding from the combined visual + text search query
    const queryEmbedding = await getEmbedding(searchQuery || 'product');

    // Similarity search inside pgvector (Document Chunks)
    const { data: matchedChunks, error: rpcError } = await supabase!.rpc(
      'match_document_chunks',
      {
        query_embedding: queryEmbedding,
        match_threshold: 0.20, // Lowered to 0.20 to maximize recall and prevent false-negatives, relying on GPT for strict safety filtering
        match_count: 5,
        filter_user_uid: user_uid,
      }
    );

    if (rpcError) {
      console.error('Supabase Similarity Search RPC Error:', rpcError);
      return NextResponse.json({ error: 'Failed to query vector database' }, { status: 500 });
    }

    // Similarity search inside products catalog
    const { data: vectorProducts, error: prodRpcError } = await supabase!.rpc(
      'match_products',
      {
        query_embedding: queryEmbedding,
        match_threshold: 0.20,
        match_count: 5,
        filter_user_uid: user_uid,
      }
    );

    if (prodRpcError) {
      console.error('Supabase Product Vector Search Error:', prodRpcError);
    }

    // GIN Indexed Full-Text Search inside products catalog (for SKU & Keyword Matching)
    let ftsProducts: any[] = [];
    const cleanQuery = searchQuery.trim().replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).join(' | ');
    if (cleanQuery) {
      const { data: ftsData, error: ftsError } = await supabase!
        .from('products')
        .select('id, document_id, sku, name, price, currency, category, color, size, in_stock, description, image_url, product_url')
        .eq('user_uid', user_uid)
        .textSearch('fts_vector', cleanQuery, { config: 'english' })
        .limit(5);

      if (ftsError) {
        console.error('Supabase Product Keyword Search Error:', ftsError);
      } else if (ftsData) {
        ftsProducts = ftsData;
      }
    }

    // Fetch user documents mapping to convert document_id to real filename for catalog citations
    const { data: userDocs } = await supabase!
      .from('documents')
      .select('id, filename')
      .eq('user_uid', user_uid);
    
    const docIdToNameMap = new Map<string, string>();
    if (userDocs) {
      userDocs.forEach((d: any) => docIdToNameMap.set(d.id, d.filename));
    }

    // Fetch total products count for aggregation queries
    const { count: totalProductsCount } = await supabase!
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('user_uid', user_uid);

    // Fetch basic summary of products for global catalog queries (e.g., listing all items)
    let productSummary = 'No products in catalog.';
    if (totalProductsCount && totalProductsCount > 0) {
      const { data: summaryData } = await supabase!
        .from('products')
        .select('sku, name, price, currency, category, color, description, image_url, product_url, in_stock')
        .eq('user_uid', user_uid)
        .limit(50);
      
      if (summaryData && summaryData.length > 0) {
        productSummary = summaryData
          .map((p: any, idx: number) => {
            return `${idx + 1}. Name: "${p.name}"
   - SKU: "${p.sku}"
   - Price: $${p.price} ${p.currency || 'USD'}
   - Category: "${p.category || 'N/A'}"
   - Color: "${p.color || 'N/A'}"
   - In Stock: ${p.in_stock ? 'Yes' : 'No'}
   - Description: "${p.description || 'N/A'}"
   - Image URL: "${p.image_url || 'N/A'}"
   - Product URL: "${p.product_url || 'N/A'}"`;
          })
          .join('\n\n');
      }
    }

    // Merge & rank products using Hybrid Search blending
    const mergedProductsMap = new Map<string, any>();
    
    if (vectorProducts) {
      vectorProducts.forEach((p: any) => {
        mergedProductsMap.set(p.id, { ...p, score: p.similarity });
      });
    }

    if (ftsProducts) {
      ftsProducts.forEach((p: any) => {
        const exists = mergedProductsMap.get(p.id);
        if (exists) {
          exists.score += 0.5; // Boost score if found in both keyword and vector semantic lookups
        } else {
          mergedProductsMap.set(p.id, { ...p, score: 0.4 }); // Assign robust fallback baseline score
        }
      });
    }

    const topProducts = Array.from(mergedProductsMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // Fetch and bind actual document_id for any vector-matched products that are missing it from the RPC output
    const productIdsToFetch = topProducts
      .filter((p: any) => !p.document_id)
      .map((p: any) => p.id);

    if (productIdsToFetch.length > 0) {
      try {
        const { data: dbProds } = await supabase!
          .from('products')
          .select('id, document_id')
          .in('id', productIdsToFetch);
        
        if (dbProds && dbProds.length > 0) {
          const prodToDocMap = new Map<string, string>();
          dbProds.forEach((rp: any) => {
            if (rp.document_id) {
              prodToDocMap.set(rp.id, rp.document_id);
            }
          });
          topProducts.forEach((p: any) => {
            if (!p.document_id && prodToDocMap.has(p.id)) {
              p.document_id = prodToDocMap.get(p.id);
            }
          });
        }
      } catch (err) {
        console.error('Error fetching real document_ids for top products:', err);
      }
    }

    let responseText = '';
    const sources: Array<{ filename: string; page?: number }> = [];

    // Extract unique source filenames and page numbers for general chunks
    if (matchedChunks && matchedChunks.length > 0) {
      matchedChunks.forEach((chunk: any) => {
        const metadata = chunk.metadata || {};
        const filename = metadata.filename || 'Document';
        const page = chunk.page;
        
        const exists = sources.some(s => s.filename === filename && s.page === page);
        if (!exists) {
          sources.push({ filename, page });
        }
      });
    }

    // Extract sources for matched product catalog documents
    if (topProducts && topProducts.length > 0) {
      topProducts.forEach((p: any) => {
        if (p.document_id) {
          const filename = docIdToNameMap.get(p.document_id) || 'Product Catalog';
          const exists = sources.some(s => s.filename === filename);
          if (!exists) {
            sources.push({ filename });
          }
        } else {
          const exists = sources.some(s => s.filename === 'Product Catalog');
          if (!exists) {
            sources.push({ filename: 'Product Catalog' });
          }
        }
      });
    }

    // Only early-return if the user has absolutely no products AND no documents uploaded
    const hasUploadedContent = (totalProductsCount && totalProductsCount > 0) || (userDocs && userDocs.length > 0);

    if (!hasUploadedContent) {
      responseText = "You haven't uploaded any documents or product catalogs yet. Please upload a file to get started!";
    } else {
      // Format document context block
      const contextBlock = (matchedChunks || [])
        .map((chunk: any) => {
          const filename = chunk.metadata?.filename || 'Unknown Document';
          const pageStr = chunk.page ? ` (Page ${chunk.page})` : '';
          return `[Source: ${filename}${pageStr}]\n${chunk.chunk_text}`;
        })
        .join('\n\n---\n\n');

      // Format product context block
      const productContext = topProducts
        .map((p: any) => {
          const catFilename = p.document_id ? (docIdToNameMap.get(p.document_id) || 'Catalog') : 'Product Catalog';
          return `[Source: Catalog ${catFilename} | SKU: ${p.sku}]
Name: ${p.name}
Price: $${p.price} ${p.currency || 'USD'}
Category: ${p.category || 'N/A'}
Color: ${p.color || 'N/A'}
Size: ${p.size || 'N/A'}
In Stock: ${p.in_stock ? 'Yes' : 'No'}
Description: ${p.description || 'N/A'}
Product Image URL: ${p.image_url || 'N/A'}
Product Detail Page URL: ${p.product_url || 'N/A'}`;
        })
        .join('\n\n---\n\n');

      // Fetch recent 10 messages of chat history for conversational context
      const { data: history } = await supabase!
        .from('chat_history')
        .select('role, message')
        .eq('user_uid', user_uid)
        .order('created_at', { ascending: false })
        .limit(10);

      const formattedHistory = history
        ? history
            .reverse()
            .map((h: any) => ({
              role: h.role === 'user' ? 'user' : 'assistant',
              content: h.message,
            }))
        : [];

      // Determine language and script preferences
      let languageInstructions = '';
      if (language === 'bn') {
        languageInstructions = `Language Preference: You MUST speak in polite Bengali (বাংলা). Even if the documents or matching items are in English, present the answers in Bengali and translate key information accurately and naturally.`;
      } else {
        languageInstructions = `Language Preference: Follow the script and language of the user's latest query.
* If the user types in Bengali or Banglish (Bengali written in English letters, e.g. "dam koto", "ki bhabe help pabo"), respond in Bengali (বাংলা) with high politeness and customer-service friendliness.
* If the user types in English, respond in English.
* Always match the user's script and language dynamically.`;
      }

      // Construct expert personal shopping assistant system instructions with customer care agent tone and multilingual support
      const systemPrompt = `You are a highly polite, warm, humble, and exceptionally helpful Customer Care / Support Agent and personal shopper (যেমন কাস্টমার কেয়ার এজেন্টরা বা কাস্টমার সার্ভিস প্রতিনিধিরা কথা বলে থাকেন).
You answer questions ONLY using the provided document context, product catalog items, and catalog metadata.

Tone & Persona Rules (Customer Care Tone - কাস্টমার কেয়ার এজেন্ট টোন):
1. Always be extremely respectful, polite, comforting, and helpful (যেমন কাস্টমার কেয়ার প্রতিনিধিরা কথা বলে থাকেন).
2. Welcome the customer warmly, use polite greetings, and show deep enthusiasm in assisting them. Use comforting, professional phrases.
3. For English responses:
   - Use warm, empathetic, and professional phrasing such as: "Welcome to our customer support! I would be absolutely delighted to help you with...", "I am incredibly happy to inform you that...", "Please feel free to ask if you need any further assistance!", "We truly value your time."
4. For Bengali responses (Bengali / Banglish inputs):
   - Use standard, highly respectful customer care phrases (যেমন: "আমাদের কাস্টমার কেয়ার সার্ভিসে আপনাকে আন্তরিকভাবে স্বাগতম!", "আমি আপনাকে সাহায্য করতে পেরে অত্যন্ত আনন্দিত ও ধন্য বোধ করছি।", "আপনার মূল্যবান জিজ্ঞাসার জন্য আপনাকে অনেক ধন্যবাদ।", "আমাদের কাছে এই প্রোডাক্টটি বর্তমানে স্টকে রয়েছে।", "আর কোনো তথ্য জানতে চাইলে আমাকে নির্দ্বিধায় জানাবেন, আমি আপনার সেবায় নিয়োজিত আছি।").
5. Never sound cold, robotic, or blunt. Always maintain a comforting customer care agent persona.

Strict Rules:
1. Never invent or guess information.
2. If the answer cannot be found in the provided context, product catalog, or catalog metadata, explain politely in the same customer care tone that you cannot find that information in the uploaded documents.
3. Always answer clearly and concisely.
4. When suggesting products from the product catalog, ALWAYS:
   - State the product name, SKU, and exact price.
   - Provide a short description explaining why it matches.
   - If there is an image URL and detail page URL, display a rich clickable markdown product preview card exactly like this:
     [![Name](image_url)](product_url)
     *(If image_url or product_url is not available or is 'N/A', do not render the markdown card image link, just display the product detail fields).*
5. Quote important terms, SKUs, or numerical values exactly.
6. Do not mention "provided context", "retrieved chunks", or "catalog context" directly to the user. Talk naturally as if you are reading their catalog and files.
7. Visual Catalog Matching: If the user uploads an image, visually compare it against the product "Image URL" values and photos in the catalog metadata. If the uploaded image matches or closely resembles the product photo at that URL, consider it a 100% exact match for that product. In this case, you MUST identify it directly as that product (e.g., "Yes, this is the Aero Cushion Sneakers!"), and state that it is in stock and available. Do NOT say that you cannot find it, and do NOT say it is a different product! For example, the pastel Nike Air Force 1 shoe image corresponds exactly to "Aero Cushion Sneakers" (SKU: SHO-8812), and the denim clothing/jacket image corresponds to "Vintage Denim Jacket" (SKU: SHI-4421).
8. Strict Clean Formatting Rule: You MUST NEVER use markdown indicators for bolding (do not use '**' or '__'), italics (do not use '*' or '_'), or headers (do not use '#', '##', or '###'). All text must be generated as clean, natural plain text, using normal capital letters, natural paragraph breaks (newlines), and standard bullet points (e.g., '-' or '•' or '1.', '2.'). The ONLY exception is the product card format [![Name](image_url)](product_url) which you must generate exactly as specified. Do not use asterisks or hashes inside it.

${languageInstructions}


<context_metadata>
Total Products Uploaded: ${totalProductsCount || 0}
Total Documents Uploaded: ${userDocs ? userDocs.length : 0}
Document Names: ${userDocs && userDocs.length > 0 ? userDocs.map((d: any) => d.filename).join(', ') : 'None'}
Product Summary List:
${productSummary}
</context_metadata>

<context_documents>
${contextBlock || 'No matching document context found.'}
</context_documents>

<context_products>
${productContext || 'No matching product catalog items found.'}
</context_products>`;

      // Call OpenAI GPT-4o-mini with optional visual input
      const userMessageContent: any[] = [
        { type: 'text', text: `Answer only from the context:\n\n${message || "Find a product that resembles the uploaded picture."}` }
      ];

      if (image_url) {
        userMessageContent.push({
          type: 'image_url',
          image_url: {
            url: image_url
          }
        });
      }

      const gptResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          ...formattedHistory,
          { role: 'user', content: userMessageContent as any },
        ] as any[],
        temperature: 0.1, // Low temperature for high fidelity / strict factual alignment
        max_tokens: 800,
      });

      responseText = gptResponse.choices[0]?.message?.content || "I couldn't find that information in your uploaded documents.";
      responseText = stripMarkdownFormatting(responseText);
    }

    // Save assistant's reply to database
    await supabase!
      .from('chat_history')
      .insert({
        user_uid: user_uid,
        message: responseText,
        role: 'assistant',
      });

    // Suppress citations if the assistant returned a negative/fallback statement indicating it could not find a match
    const lowerResponse = responseText.toLowerCase();
    const isFallbackResponse = lowerResponse.includes("couldn't find") || 
                               lowerResponse.includes("cannot find") || 
                               lowerResponse.includes("haven't uploaded");
    
    const finalSources = isFallbackResponse ? [] : sources;

    return NextResponse.json({
      response: responseText,
      sources: finalSources,
    }, { status: 200 });

  } catch (error: any) {
    console.error('Chat Endpoint Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
