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

async function generateVisualDescriptions() {
  console.log('Fetching products from database...');
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, description, image_url');

  if (error) {
    console.error('Error fetching products:', error);
    return;
  }

  console.log(`Found ${products.length} products in DB.`);

  for (const prod of products) {
    if (!prod.image_url) {
      console.log(`Skipping product ${prod.name} (No image URL)`);
      continue;
    }

    if (prod.description && prod.description.includes('[Visual description:')) {
      console.log(`Skipping product ${prod.name} (Already has visual description)`);
      continue;
    }

    console.log(`\nAnalyzing image for: ${prod.name}...`);
    try {
      const response = await openai.chat.completions.create({
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
                  url: prod.image_url
                }
              }
            ]
          }
        ],
        max_tokens: 50,
      });

      const visualDesc = response.choices[0]?.message?.content?.trim();
      console.log(`Visual Description: "${visualDesc}"`);

      if (visualDesc) {
        const originalDesc = prod.description || '';
        const updatedDesc = `${originalDesc} [Visual description: ${visualDesc}]`.trim();

        const { error: updateError } = await supabase
          .from('products')
          .update({ description: updatedDesc })
          .eq('id', prod.id);

        if (updateError) {
          console.error(`Error updating product ${prod.name}:`, updateError);
        } else {
          console.log(`Successfully updated product: ${prod.name}`);
        }
      }
    } catch (err) {
      console.error(`Error processing product ${prod.name}:`, err);
    }
  }

  console.log('\n--- Finished processing all products! ---');
}

generateVisualDescriptions();
