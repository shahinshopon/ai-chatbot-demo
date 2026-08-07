const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');

// Manually parse .env.local
const envPath = path.join(__dirname, '../../.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] ? match[2].trim() : '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    }
    env[match[1]] = value;
  }
});

const supabaseUrl = env.SUPABASE_URL;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const apiKey = env.OPENAI_API_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const openai = new OpenAI({ apiKey });

async function getEmbedding(text) {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.replace(/\n/g, ' '),
  });
  return response.data[0].embedding;
}

async function testMatch() {
  // Test image url from Vintage Denim Jacket (already uploaded in DB)
  // Let's test with the denim jacket keywords first
  const searchQuery = "denim jacket, blue, cotton, chest pockets";
  console.log('Query text:', searchQuery);
  
  const queryEmbedding = await getEmbedding(searchQuery);
  
  // Try querying match_products with threshold 0.10, 0.20, and 0.30
  for (const threshold of [0.10, 0.20, 0.30]) {
    console.log(`\n--- Testing match_products with threshold: ${threshold} ---`);
    const { data, error } = await supabase.rpc('match_products', {
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: 5,
      filter_user_uid: 'simulated_user_uid_or_real' // Let's check what user_uid is in the DB
    });
    
    if (error) {
      console.error('RPC Error:', error);
    } else {
      console.log(`Matches found: ${data.length}`);
      data.forEach(p => {
        console.log(`- SKU: ${p.sku}, Name: ${p.name}, Similarity: ${p.similarity}`);
      });
    }
  }

  // Let's fetch all products to check their user_uid!
  const { data: allProducts } = await supabase.from('products').select('*');
  console.log('\n--- All Products in DB ---');
  allProducts.forEach(p => {
    console.log(`- SKU: ${p.sku}, Name: ${p.name}, User UID: ${p.user_uid}`);
  });
}

testMatch();
