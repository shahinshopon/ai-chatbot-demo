import * as xlsx from 'xlsx';
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
 * Normalizes various date formats to ISO format (YYYY-MM-DD)
 * Handles: DD/MM/YY, DD/MM/YYYY, DD-MM-YY, DD-MM-YYYY, YYYY-MM-DD, MM/DD/YY, MM/DD/YYYY
 */
function normalizeDateFormat(text: string): string {
  let normalized = text;

  // Pattern 1: DD/MM/YY or DD-MM-YY (European format with 2-digit year)
  normalized = normalized.replace(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})\b/g, (match, day, month, year) => {
    const d = parseInt(day, 10);
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    // If day > 12, assume it's DD/MM format
    if (d > 12) {
      const fullYear = y < 30 ? 2000 + y : 1900 + y;
      return `${fullYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    // Otherwise, try to infer from context or assume DD/MM
    const fullYear = y < 30 ? 2000 + y : 1900 + y;
    return `${fullYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  });

  // Pattern 2: DD/MM/YYYY or DD-MM-YYYY (European format with 4-digit year)
  normalized = normalized.replace(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/g, (match, day, month, year) => {
    const d = parseInt(day, 10);
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    if (d > 12) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  });

  return normalized;
}

/**
 * Detects if tabular data is likely a sales record (Date, Customer/ID, Product, Price)
 * Returns true if headers suggest sales transaction data
 */
function isSalesRecordData(headers: string[]): boolean {
  const headerLower = headers.map(h => h.toLowerCase().trim());
  
  const hasDateCol = headerLower.some(h => ['date', 'time', 'datetime', 'timestamp'].some(term => h.includes(term)));
  const hasCustomerCol = headerLower.some(h => ['name', 'customer', 'id', 'account', 'client', 'buyer'].some(term => h.includes(term)));
  const hasPriceCol = headerLower.some(h => ['price', 'amount', 'cost', 'total', 'value'].some(term => h.includes(term)));
  
  // Sales record data has date + customer + price columns
  return hasDateCol && hasCustomerCol && hasPriceCol;
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
    case 'xlsx':
      return parseXlsx(buffer);
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
 * Also normalizes dates in extracted text.
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
          const normalizedText = normalizeDateFormat(data.text);
          return {
            text: normalizedText,
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
        const normalizedText = normalizeDateFormat(data.text);
        return {
          text: normalizedText,
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
      const pdfParser = new PDFParser(null, true as any); // true = text mode
      
      pdfParser.on('pdfParser_dataError', (errData: any) => {
        reject(new Error(errData.parserError));
      });
      
      pdfParser.on('pdfParser_dataReady', () => {
        resolve(pdfParser.getRawTextContent());
      });
      
      pdfParser.parseBuffer(buffer);
    });

    if (data && data.trim().length > 0) {
      const normalizedText = normalizeDateFormat(data.replace(/%20/g, ' ').replace(/%2C/g, ',').replace(/%3A/g, ':'));
      return {
        text: normalizedText,
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
      const normalizedText = normalizeDateFormat(rawText);
      return {
        text: normalizedText,
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
 * Parses CSV catalog documents with date normalization and sales record detection.
 */
async function parseCsv(buffer: Buffer): Promise<ParsedDocument> {
  const content = buffer.toString('utf-8');
  
  // Normalize dates in content
  const normalizedContent = normalizeDateFormat(content);
  
  const rows = parseCSVLines(normalizedContent);
  if (rows.length < 2) {
    return { text: normalizedContent, pageCount: 1, products: [] };
  }

  // Look for headers in the first 3 rows to handle poorly formatted CSVs
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(3, rows.length); i++) {
    if (rows[i].length > 2) {
      headerRowIdx = i;
      break;
    }
  }

  const headers = rows[headerRowIdx].map(h => h.toLowerCase());
  
  // Check if this is sales record data
  if (isSalesRecordData(rows[headerRowIdx])) {
    const products = extractSalesRecordsAsProductsFromRows(rows, headerRowIdx);
    let summaryText = '';
    for (const row of rows) {
      if (row.join('').trim()) summaryText += row.join(', ') + '\n';
    }
    return { text: summaryText, pageCount: 1, products };
  }
  
  const findIndex = (terms: string[]) => {
    return headers.findIndex(h => terms.some(t => h.includes(t)));
  };

  const nameIdx = findIndex(['name', 'title', 'heading', 'product']);
  
  // If we can't find a name column, this is NOT a product catalog.
  // Fall back to treating it as a generic data table for RAG.
  if (nameIdx === -1) {
    let rawText = '';
    for (const row of rows) {
      if (row.length === 0 || !row.join('').trim()) continue;
      rawText += row.join(', ') + '\n';
    }
    return { text: rawText, pageCount: 1, products: [] };
  }

  const skuIdx = findIndex(['sku', 'id', 'handle', 'code']);
  const priceIdx = findIndex(['price', 'cost', 'amount', 'value']);
  const originalPriceIdx = findIndex(['original price', 'regular price', 'msrp', 'was']);
  const discountPriceIdx = findIndex(['discount price', 'sale price', 'now']);
  const paidIdx = findIndex(['paid', 'advance']);
  const dueIdx = findIndex(['due', 'pending', 'discount']);
  const categoryIdx = findIndex(['category', 'type', 'tags', 'department']);
  const colorIdx = findIndex(['color', 'colour']);
  const sizeIdx = findIndex(['size']);
  const inStockIdx = findIndex(['stock', 'inventory', 'available', 'instock']);
  const descriptionIdx = findIndex(['description', 'body', 'detail', 'text', 'about']);
  const imageIdx = findIndex(['image', 'img', 'thumbnail', 'photo']);
  const urlIdx = findIndex(['url', 'link', 'permalink', 'href']);

  const products: ParsedProduct[] = [];
  let summaryText = '';

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 0 || !row.join('').trim()) continue;

    const name = nameIdx !== -1 && row[nameIdx] ? row[nameIdx] : '';
    if (!name) continue;

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

    let description = descriptionIdx !== -1 && row[descriptionIdx] ? row[descriptionIdx] : '';
    const originalPrice = originalPriceIdx !== -1 && row[originalPriceIdx] ? row[originalPriceIdx] : '';
    const discountPrice = discountPriceIdx !== -1 && row[discountPriceIdx] ? row[discountPriceIdx] : '';
    const paid = paidIdx !== -1 && row[paidIdx] ? row[paidIdx] : '';
    const due = dueIdx !== -1 && row[dueIdx] ? row[dueIdx] : '';

    if (originalPrice) description += (description ? ' | ' : '') + `Original Price: ${originalPrice}`;
    if (discountPrice) description += (description ? ' | ' : '') + `Discount Price: ${discountPrice}`;
    if (paid) description += (description ? ' | ' : '') + `Paid: ${paid}`;
    if (due) description += (description ? ' | ' : '') + `Due/Discount: ${due}`;

    const finalDescription = description.trim() === '' ? undefined : description;

    const image_url = imageIdx !== -1 && row[imageIdx] ? row[imageIdx] : undefined;
    const product_url = urlIdx !== -1 && row[urlIdx] ? row[urlIdx] : undefined;

    products.push({
      sku, name, price, currency: undefined, category, color, size, inStock, description: finalDescription, image_url, product_url,
    });

    summaryText += `Product: ${name} (SKU: ${sku}) | Price: ${price} | Category: ${category || 'None'} | Description: ${finalDescription || 'No description'}\n`;
  }

  // If we skipped everything because it was badly formatted but had a header, just dump it as raw text
  if (products.length === 0) {
    let rawText = '';
    for (const row of rows) {
      if (row.join('').trim()) rawText += row.join(', ') + '\n';
    }
    return { text: rawText, pageCount: 1, products: [] };
  }

  return {
    text: summaryText,
    pageCount: 1,
    products,
  };
}

/**
 * Extracts sales records from parsed row array and converts to structured products
 */
function extractSalesRecordsAsProductsFromRows(rows: string[][], headerRowIdx: number): ParsedProduct[] {
  const headers = rows[headerRowIdx];
  const products: ParsedProduct[] = [];
  
  // Find column indices
  const dateIdx = headers.findIndex(h => ['date', 'time', 'datetime', 'timestamp'].some(term => h.toLowerCase().includes(term)));
  const customerIdx = headers.findIndex(h => ['name', 'customer', 'id', 'account', 'client', 'buyer'].some(term => h.toLowerCase().includes(term)));
  const productIdx = headers.findIndex(h => ['product', 'item', 'service', 'description'].some(term => h.toLowerCase().includes(term)));
  const priceIdx = headers.findIndex(h => ['price', 'amount', 'cost', 'total', 'value'].some(term => h.toLowerCase().includes(term)));
  const quantityIdx = headers.findIndex(h => ['qty', 'quantity', 'count', 'units'].some(term => h.toLowerCase().includes(term)));

  // Process each data row as a sales transaction
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 0 || !row.join('').trim()) continue;

    const date = dateIdx !== -1 ? row[dateIdx] : '';
    const customer = customerIdx !== -1 ? row[customerIdx] : '';
    const productName = productIdx !== -1 ? row[productIdx] : '';
    const priceStr = priceIdx !== -1 ? row[priceIdx] : '0';
    const quantityStr = quantityIdx !== -1 ? row[quantityIdx] : '1';

    if (!customer || !date) continue;

    const price = parseFloat(priceStr.replace(/[^0-9.]/g, '')) || 0;
    const quantity = parseInt(quantityStr, 10) || 1;

    // Create unique SKU from date + customer ID
    const sanitizedCustomer = customer.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 10);
    const sku = `${date}-${sanitizedCustomer}-${String(i).padStart(3, '0')}`;

    // Build comprehensive description from all row data
    const description = `Sales Record - Date: ${date}, Customer: ${customer}, Item: ${productName || 'N/A'}, Quantity: ${quantity}, Price per Unit: ${price} BDT`;

    products.push({
      sku,
      name: `${customer} - ${productName || 'Transaction'} (${date})`,
      price: price * quantity, // Total price for transaction
      currency: 'BDT',
      category: 'Sales Record',
      description,
      inStock: true,
    });
  }

  return products;
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

  if (items.length === 0) {
    return { text: content, pageCount: 1, products: [] };
  }

  const products: ParsedProduct[] = [];
  let summaryText = '';

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    // Determine product name with tolerant fallback; always produce a name
    const name = item.name || item.title || item.product_name || item.label || `Product-${i}`;
    if (!name) {
      console.warn(`Skipping product at index ${i} due to missing name field.`, item);
    }

    const sku = item.sku || item.id || `SKU-${1000 + i}`;
    const price = parseFloat(String(item.price || item.cost || 0).replace(/[^0-9.]/g, '')) || 0;
    const category = item.category || item.type || undefined;
    const color = item.color || item.colour || undefined;
    const size = item.size || undefined;
    const inStock = item.in_stock !== false && item.inStock !== false && item.available !== false;
    let description = item.description || item.body || (Array.isArray(item.flavorProfile) ? item.flavorProfile.join(', ') : '');
    
    const originalPrice = item.original_price || item.originalPrice || item.regular_price || item.msrp || '';
    const discountPrice = item.discount_price || item.discountPrice || item.sale_price || '';
    const paid = item.paid || item.advance || '';
    const due = item.due || item.pending || item.discount || '';

    if (originalPrice) description += (description ? ' | ' : '') + `Original Price: ${originalPrice}`;
    if (discountPrice) description += (description ? ' | ' : '') + `Discount Price: ${discountPrice}`;
    if (paid) description += (description ? ' | ' : '') + `Paid: ${paid}`;
    if (due) description += (description ? ' | ' : '') + `Due/Discount: ${due}`;

    const finalDescription = description.trim() === '' ? undefined : description;

    const image_url = item.image_url || item.image || item.thumbnail || undefined;
    const product_url = item.product_url || item.url || item.link || undefined;

    products.push({
      sku,
      name,
      price,
      currency: item.currency || undefined,
      category,
      color,
      size,
      inStock,
      description: finalDescription,
      image_url,
      product_url,
    });

    summaryText += `Product: ${name} (SKU: ${sku}) | Price: $${price} | Category: ${category || 'None'} | Description: ${finalDescription || 'No description'}\n`;
  }

  return {
    text: summaryText,
    pageCount: 1,
    products,
  };
}




/**
 * Parses XLSX Excel documents with date normalization and sales record detection.
 */
async function parseXlsx(buffer: Buffer): Promise<ParsedDocument> {
  let workbook;
  try {
    workbook = xlsx.read(buffer, { type: 'buffer' });
  } catch (e) {
    throw new Error('Invalid Excel file format.');
  }

  let text = '';
  const products: ParsedProduct[] = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    text += `--- Sheet: ${sheetName} ---\n`;
    let csvStr = xlsx.utils.sheet_to_csv(worksheet);
    
    // Normalize dates in the sheet
    csvStr = normalizeDateFormat(csvStr);
    
    // Try to extract structured products from sales data
    const sheetProducts = extractSalesRecordsAsProducts(csvStr, sheetName);
    if (sheetProducts.length > 0) {
      products.push(...sheetProducts);
    }
    
    text += csvStr + '\n\n';
  }

  if (!text || text.trim().length === 0) {
    throw new Error('Excel document contains no extractable text');
  }

  return { text, pageCount: workbook.SheetNames.length, products };
}

/**
 * Extracts sales transaction records from CSV-formatted data and converts them to structured products.
 * Each transaction becomes a unique product with SKU based on date + customer ID.
 */
function extractSalesRecordsAsProducts(csvStr: string, sheetName: string): ParsedProduct[] {
  const rows = csvStr.split('\n').map(line => parseCSVLine(line)).filter(r => r.length > 0);
  
  if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.toLowerCase().trim());
  
  // Check if this looks like sales record data
  if (!isSalesRecordData(headers)) {
    return [];
  }

  const products: ParsedProduct[] = [];
  
  // Find column indices
  const dateIdx = headers.findIndex(h => ['date', 'time', 'datetime', 'timestamp'].some(term => h.includes(term)));
  const customerIdx = headers.findIndex(h => ['name', 'customer', 'id', 'account', 'client', 'buyer'].some(term => h.includes(term)));
  const productIdx = headers.findIndex(h => ['product', 'item', 'service', 'description'].some(term => h.includes(term)));
  const priceIdx = headers.findIndex(h => ['price', 'amount', 'cost', 'total', 'value'].some(term => h.includes(term)));
  const quantityIdx = headers.findIndex(h => ['qty', 'quantity', 'count', 'units'].some(term => h.includes(term)));

  // Process each data row as a sales transaction
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 0 || !row.join('').trim()) continue;

    const date = dateIdx !== -1 ? row[dateIdx] : '';
    const customer = customerIdx !== -1 ? row[customerIdx] : '';
    const productName = productIdx !== -1 ? row[productIdx] : '';
    const priceStr = priceIdx !== -1 ? row[priceIdx] : '0';
    const quantityStr = quantityIdx !== -1 ? row[quantityIdx] : '1';

    if (!customer || !date) continue;

    const price = parseFloat(priceStr.replace(/[^0-9.]/g, '')) || 0;
    const quantity = parseInt(quantityStr, 10) || 1;

    // Create unique SKU from date + customer ID
    const sanitizedCustomer = customer.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 10);
    const sku = `${date}-${sanitizedCustomer}-${String(i).padStart(3, '0')}`;

    // Build comprehensive description from all row data
    const description = `Sales Record - Date: ${date}, Customer: ${customer}, Item: ${productName || 'N/A'}, Quantity: ${quantity}, Price per Unit: ${price} BDT`;

    products.push({
      sku,
      name: `${customer} - ${productName || 'Transaction'} (${date})`,
      price: price * quantity, // Total price for transaction
      currency: 'BDT',
      category: 'Sales Record',
      description,
      inStock: true,
    });
  }

  return products;
}

/**
 * Simple CSV line parser handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  if (!line.trim()) return [];
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
  return row;
}
