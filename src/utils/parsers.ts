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
 * Parses PDF files using pdf-parse.
 */
async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  try {
    // Polyfill missing DOM variables globally on Node server-side to satisfy older pdfjs-dist dependencies
    if (typeof global !== 'undefined') {
      if (!(global as any).DOMMatrix) {
        (global as any).DOMMatrix = class DOMMatrix {};
      }
      if (!(global as any).ImageData) {
        (global as any).ImageData = class ImageData {};
      }
      if (!(global as any).Path2D) {
        (global as any).Path2D = class Path2D {};
      }
    }

    const pdfParseModule = require('pdf-parse');

    // 1. Support modern class-based pdf-parse (v2.x+ by Mehmet Kozan)
    if (pdfParseModule && typeof pdfParseModule.PDFParse === 'function') {
      const parser = new pdfParseModule.PDFParse({ data: buffer });
      try {
        const data = await parser.getText();
        return {
          text: data.text || '',
          pageCount: data.total || 1,
        };
      } finally {
        if (parser && typeof parser.destroy === 'function') {
          await parser.destroy();
        }
      }
    }

    // 2. Support legacy function-based pdf-parse (v1.x)
    let pdfParseFn;
    if (pdfParseModule && typeof pdfParseModule.default === 'function') {
      pdfParseFn = pdfParseModule.default;
    } else if (typeof pdfParseModule === 'function') {
      pdfParseFn = pdfParseModule;
    } else {
      throw new Error('PDF parsing library was loaded but no callable parser function or PDFParse class was found.');
    }

    const data = await pdfParseFn(buffer);
    return {
      text: data.text || '',
      pageCount: data.numpages || 1,
    };
  } catch (error) {
    console.error('Error parsing PDF document:', error);
    throw new Error('Failed to parse PDF document. Ensure the file is not corrupted.');
  }
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



