import mammoth from 'mammoth';

// Polyfill missing DOM elements at the module level on Node server-side to satisfy pdfjs-dist requirements
if (typeof global !== 'undefined') {
  if (!(global as any).DOMMatrix) (global as any).DOMMatrix = class DOMMatrix {};
  if (!(global as any).ImageData) (global as any).ImageData = class ImageData {};
  if (!(global as any).Path2D) (global as any).Path2D = class Path2D {};
}
if (typeof globalThis !== 'undefined') {
  if (!(globalThis as any).DOMMatrix) (globalThis as any).DOMMatrix = class DOMMatrix {};
  if (!(globalThis as any).ImageData) (globalThis as any).ImageData = class ImageData {};
  if (!(globalThis as any).Path2D) (globalThis as any).Path2D = class Path2D {};
}
if (typeof window !== 'undefined') {
  if (!(window as any).DOMMatrix) (window as any).DOMMatrix = class DOMMatrix {};
  if (!(window as any).ImageData) (window as any).ImageData = class ImageData {};
  if (!(window as any).Path2D) (window as any).Path2D = class Path2D {};
}

export interface ParsedProduct {
  sku: string;
  name: string;
  price: number;
  currency?: string;
  category?: string;
  color?: string;
  size?: string;
  inStock?: boolean;
  description?: string;
  image_url?: string;
  product_url?: string;
}

export interface ParsedDocument {
  text: string;
  pageCount: number;
  products?: ParsedProduct[];
}

/**
 * Parses file buffer into plain text based on file format.
 * 
 * @param buffer The file buffer to parse.
 * @param filename Name of the file to determine parsing mode.
 */
export async function parseDocument(
  buffer: Buffer,
  filename: string
): Promise<ParsedDocument> {
  const extension = filename.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'txt':
      return parseTxt(buffer);
    case 'docx':
      return parseDocx(buffer);
    case 'pdf':
      return parsePdf(buffer);
    case 'csv':
      return parseCsv(buffer);
    case 'json':
      return parseJson(buffer);
    default:
      throw new Error(`Unsupported file extension: .${extension}`);
  }
}

/**
 * Parses plain text files.
 */
async function parseTxt(buffer: Buffer): Promise<ParsedDocument> {
  const text = buffer.toString('utf-8');
  return {
    text,
    pageCount: 1,
  };
}

/**
 * Parses DOCX files using mammoth.
 */
async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  const result = await mammoth.extractRawText({ buffer });
  return {
    text: result.value || '',
    pageCount: 1, // Word docs don't have explicit pages in raw text extraction
  };
}

/**
 * Parses PDF files using pdf-parse with fallback to pure text stream parser.
 */
async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  const errors: string[] = [];

  // 1. Polyfill missing DOM variables globally on Node server-side
  if (typeof global !== 'undefined') {
    if (!(global as any).DOMMatrix) (global as any).DOMMatrix = class DOMMatrix {};
    if (!(global as any).ImageData) (global as any).ImageData = class ImageData {};
    if (!(global as any).Path2D) (global as any).Path2D = class Path2D {};
  }

  const uint8Data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // Attempt 1: Modern class-based pdf-parse (v2.x)
  try {
    const pdfParseModule = (await import('pdf-parse')) as any;

    if (pdfParseModule && typeof pdfParseModule.PDFParse === 'function') {
      const parser = new pdfParseModule.PDFParse({ data: uint8Data });
      try {
        const data = await parser.getText();
        if (data && data.text && data.text.trim().length > 0) {
          return {
            text: data.text,
            pageCount: data.total || 1,
          };
        }
      } finally {
        if (parser && typeof parser.destroy === 'function') {
          await parser.destroy();
        }
      }
    }

    // Attempt 2: Legacy function-based pdf-parse (v1.x)
    let pdfParseFn;
    if (pdfParseModule && typeof pdfParseModule.default === 'function') {
      pdfParseFn = pdfParseModule.default;
    } else if (typeof pdfParseModule === 'function') {
      pdfParseFn = pdfParseModule;
    }

    if (pdfParseFn) {
      const data = await pdfParseFn(buffer);
      if (data && data.text && data.text.trim().length > 0) {
        return {
          text: data.text,
          pageCount: data.numpages || 1,
        };
      }
    }
  } catch (error: any) {
    console.warn('Primary pdf-parse engine failed:', error?.message);
    errors.push(error?.message || String(error));
  }

  // Attempt 3: pdf2json (Pure JS, Vercel safe fallback)
  try {
    console.log('Attempting pdf2json fallback...');
    const PDFParser = (await import('pdf2json')).default;
    const data = await new Promise<string>((resolve, reject) => {
      const pdfParser = new PDFParser(null, 1); // 1 = text mode
      
      pdfParser.on('pdfParser_dataError', (errData: any) => {
        reject(new Error(errData.parserError));
      });
      
      pdfParser.on('pdfParser_dataReady', () => {
        resolve(pdfParser.getRawTextContent());
      });
      
      pdfParser.parseBuffer(buffer);
    });

    if (data && data.trim().length > 0) {
      return {
        text: data.replace(/%20/g, ' ').replace(/%2C/g, ',').replace(/%3A/g, ':'), // Basic decoding if needed
        pageCount: 1, // Simple approximation
      };
    }
  } catch (pdf2jsonError: any) {
    console.warn('pdf2json fallback failed:', pdf2jsonError?.message);
    errors.push(pdf2jsonError?.message || String(pdf2jsonError));
  }

  // Attempt 4: Pure JavaScript raw PDF text stream extractor fallback (Zero native C++/Worker dependency)
  try {
    const rawText = extractRawPdfText(buffer);
    if (rawText && rawText.trim().length > 0) {
      console.log('Successfully extracted PDF text using raw stream fallback.');
      return {
        text: rawText,
        pageCount: 1,
      };
    }
  } catch (fallbackError: any) {
    errors.push(fallbackError?.message || String(fallbackError));
  }

  throw new Error(
    `Failed to parse PDF document (${errors.join(' | ') || 'Document contains no extractable text or is image-only'}). Ensure the file is not corrupted.`
  );
}

/**
 * Pure JavaScript fallback parser that extracts readable text from raw PDF streams without external dependencies.
 */
function extractRawPdfText(buffer: Buffer): string {
  const content = buffer.toString('latin1');
  const textParts: string[] = [];

  // Match (string) Tj, (string) TJ, or [(string1) ... (string2)] TJ text operators
  const tjRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*(?:Tj|TJ|\/)|\[\s*(?:\(([^)\\]*(?:\\.[^)\\]*)*)\)[^)]*)+\s*\]\s*TJ/g;
  let match;

  while ((match = tjRegex.exec(content)) !== null) {
    const rawStr = match[1] || match[2];
    if (rawStr) {
      const unescaped = rawStr
        .replace(/\\([()\\])/g, '$1')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));

      const cleaned = unescaped.trim();
      if (cleaned.length > 0) {
        textParts.push(cleaned);
      }
    }
  }

  // Second pass: Extract text blocks inside BT ... ET if operator parsing returned little text
  if (textParts.join(' ').length < 10) {
    const btRegex = /BT[\s\S]*?ET/g;
    let btMatch;
    while ((btMatch = btRegex.exec(content)) !== null) {
      const block = btMatch[0];
      const strRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
      let strMatch;
      while ((strMatch = strRegex.exec(block)) !== null) {
        const text = strMatch[1].replace(/\\([()\\])/g, '$1').trim();
        if (text.length > 0 && /[a-zA-Z0-9\u0980-\u09FF]/.test(text)) {
          textParts.push(text);
        }
      }
    }
  }

  return textParts.join(' ');
}

/**
 * Parses CSV catalog documents.
 */
async function parseCsv(buffer: Buffer): Promise<ParsedDocument> {
  const content = buffer.toString('utf-8');
  const rows = parseCSVLines(content);
  if (rows.length < 2) {
    return { text: '', pageCount: 1, products: [] };
  }

  const headers = rows[0].map(h => h.toLowerCase());
  
  // Intelligent dynamic header locator
  const findIndex = (terms: string[]) => {
    return headers.findIndex(h => terms.some(t => h.includes(t)));
  };

  const skuIdx = findIndex(['sku', 'id', 'handle', 'code']);
  const nameIdx = findIndex(['name', 'title', 'heading', 'product']);
  const priceIdx = findIndex(['price', 'cost', 'amount', 'value']);
  const categoryIdx = findIndex(['category', 'type', 'tags', 'department']);
  const colorIdx = findIndex(['color', 'colour']);
  const sizeIdx = findIndex(['size']);
  const inStockIdx = findIndex(['stock', 'inventory', 'available', 'instock']);
  const descriptionIdx = findIndex(['description', 'body', 'detail', 'text', 'about']);
  const imageIdx = findIndex(['image', 'img', 'thumbnail', 'photo']);
  const urlIdx = findIndex(['url', 'link', 'permalink', 'href']);

  const products: ParsedProduct[] = [];
  let summaryText = '';

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 0 || !row[0]) continue;

    const name = nameIdx !== -1 && row[nameIdx] ? row[nameIdx] : '';
    if (!name) continue; // Skip items without a name

    const sku = skuIdx !== -1 && row[skuIdx] ? row[skuIdx] : `SKU-${1000 + i}`;
    
    let price = 0;
    if (priceIdx !== -1 && row[priceIdx]) {
      const parsedPrice = parseFloat(row[priceIdx].replace(/[^0-9.]/g, ''));
      if (!isNaN(parsedPrice)) price = parsedPrice;
    }

    const category = categoryIdx !== -1 && row[categoryIdx] ? row[categoryIdx] : undefined;
    const color = colorIdx !== -1 && row[colorIdx] ? row[colorIdx] : undefined;
    const size = sizeIdx !== -1 && row[sizeIdx] ? row[sizeIdx] : undefined;
    
    let inStock = true;
    if (inStockIdx !== -1 && row[inStockIdx]) {
      const stockVal = row[inStockIdx].toLowerCase();
      if (stockVal === 'false' || stockVal === '0' || stockVal === 'no' || stockVal === 'out') {
        inStock = false;
      }
    }

    const description = descriptionIdx !== -1 && row[descriptionIdx] ? row[descriptionIdx] : undefined;
    const image_url = imageIdx !== -1 && row[imageIdx] ? row[imageIdx] : undefined;
    const product_url = urlIdx !== -1 && row[urlIdx] ? row[urlIdx] : undefined;

    products.push({
      sku,
      name,
      price,
      currency: 'USD',
      category,
      color,
      size,
      inStock,
      description,
      image_url,
      product_url,
    });

    summaryText += `Product: ${name} (SKU: ${sku}) | Price: $${price} | Category: ${category || 'None'} | Description: ${description || 'No description'}\n`;
  }

  return {
    text: summaryText,
    pageCount: 1,
    products,
  };
}

/**
 * Lightweight, safe CSV line-token splitter with double quotes support.
 */
function parseCSVLines(text: string): string[][] {
  const result: string[][] = [];
  const lines = text.split(/\r?\n/);
  
  for (const line of lines) {
    if (!line.trim()) continue;
    const row: string[] = [];
    let inQuotes = false;
    let currentToken = '';
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        row.push(currentToken.trim());
        currentToken = '';
      } else {
        currentToken += char;
      }
    }
    row.push(currentToken.trim());
    result.push(row);
  }
  return result;
}

/**
 * Parses JSON catalog documents.
 */
async function parseJson(buffer: Buffer): Promise<ParsedDocument> {
  const content = buffer.toString('utf-8');
  let data;
  try {
    data = JSON.parse(content);
  } catch (e) {
    throw new Error('Invalid JSON file format.');
  }

  const items = Array.isArray(data)
    ? data
    : (data.products || data.items || data.dishes || data.menu || data.catalog || data.data || []);

  if (!Array.isArray(items)) {
    throw new Error('JSON format is invalid. Ensure the file contains an array of items/products or an object with a "products", "items", "dishes", or "menu" list.');
  }

  const products: ParsedProduct[] = [];
  let summaryText = '';

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const name = item.name || item.title || '';
    if (!name) continue;

    const sku = item.sku || item.id || `SKU-${1000 + i}`;
    const price = parseFloat(String(item.price || item.cost || 0).replace(/[^0-9.]/g, '')) || 0;
    const category = item.category || item.type || undefined;
    const color = item.color || item.colour || undefined;
    const size = item.size || undefined;
    const inStock = item.in_stock !== false && item.inStock !== false && item.available !== false;
    const description = item.description || item.body || (Array.isArray(item.flavorProfile) ? item.flavorProfile.join(', ') : undefined);
    const image_url = item.image_url || item.image || item.thumbnail || undefined;
    const product_url = item.product_url || item.url || item.link || undefined;

    products.push({
      sku,
      name,
      price,
      currency: item.currency || 'USD',
      category,
      color,
      size,
      inStock,
      description,
      image_url,
      product_url,
    });

    summaryText += `Product: ${name} (SKU: ${sku}) | Price: $${price} | Category: ${category || 'None'} | Description: ${description || 'No description'}\n`;
  }

  return {
    text: summaryText,
    pageCount: 1,
    products,
  };
}



