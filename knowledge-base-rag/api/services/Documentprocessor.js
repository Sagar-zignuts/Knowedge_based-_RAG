/**
 * DocumentProcessor.js
 *
 * PURPOSE: Extract raw text from any supported document type.
 * Handles: PDF, TXT, Markdown, Images (OCR), URLs (web scraping)
 *
 * FLOW: DocumentController calls this FIRST in the indexing pipeline.
 * Input  → file path or URL string
 * Output → { text: string, pageCount: number, metadata: object }
 */

const fs = require("fs");
const path = require("path");
const axios = require("axios");

module.exports = {
  /**
   * Main entry point.
   * Detects document type and routes to the correct extractor.
   *
   * @param {string} type     - 'pdf' | 'text' | 'markdown' | 'image' | 'url'
   * @param {string} filePath - absolute path to file (or URL string for type=url)
   * @returns {Promise<{ text: string, pageCount: number, metadata: object }>}
   */
  async extractText(type, filePath) {
    sails.log.info(`[DocumentProcessor] Extracting text from type: ${type}`);

    switch (type) {
      case "pdf":
        return await this.extractFromPdf(filePath);

      case "text":
      case "markdown":
        return await this.extractFromText(filePath);

      case "image":
        return await this.extractFromImage(filePath);

      case "url":
        return await this.extractFromUrl(filePath); // filePath holds the URL here

      default:
        throw new Error(`Unsupported document type: ${type}`);
    }
  },

  // ─────────────────────────────────────────────
  // PDF EXTRACTION
  // Uses: pdf-parse
  // ─────────────────────────────────────────────
  async extractFromPdf(filePath) {
    try {
      const pdfParse = require("pdf-parse");
      const dataBuffer = fs.readFileSync(filePath);
      // pdf-parse is a function that returns a Promise
      const data = await pdfParse(dataBuffer);

      // data.text  = full extracted text
      // data.numpages = number of pages
      const cleanText = this._cleanText(data.text);

      sails.log.info(
        `[DocumentProcessor] PDF extracted: ${data.numpages} pages, ${cleanText.length} chars`,
      );

      return {
        text: cleanText,
        pageCount: data.numpages,
        metadata: {
          title:
            data.info && data.info.Title
              ? data.info.Title
              : path.basename(filePath),
          author: data.info && data.info.Author ? data.info.Author : "",
          creationDate:
            data.info && data.info.CreationDate ? data.info.CreationDate : "",
        },
      };
    } catch (err) {
      sails.log.error(
        `[DocumentProcessor] PDF extraction failed: ${err.message}`,
      );
      throw new Error(`Failed to extract PDF: ${err.message}`);
    }
  },

  // ─────────────────────────────────────────────
  // TEXT / MARKDOWN EXTRACTION
  // Uses: Node.js built-in fs
  // ─────────────────────────────────────────────
  async extractFromText(filePath) {
    try {
      let text = fs.readFileSync(filePath, "utf8");

      // Strip markdown symbols if it's a .md file
      if (filePath.endsWith(".md")) {
        text = this._stripMarkdown(text);
      }

      const cleanText = this._cleanText(text);

      sails.log.info(
        `[DocumentProcessor] Text extracted: ${cleanText.length} chars`,
      );

      return {
        text: cleanText,
        pageCount: 1,
        metadata: {
          fileName: path.basename(filePath),
          fileSize: fs.statSync(filePath).size,
        },
      };
    } catch (err) {
      sails.log.error(
        `[DocumentProcessor] Text extraction failed: ${err.message}`,
      );
      throw new Error(`Failed to extract text file: ${err.message}`);
    }
  },

  // ─────────────────────────────────────────────
  // IMAGE OCR EXTRACTION
  // Uses: tesseract.js
  // ─────────────────────────────────────────────
  async extractFromImage(filePath) {
    try {
      const Tesseract = require("tesseract.js");

      sails.log.info(`[DocumentProcessor] Starting OCR on image: ${filePath}`);

      const {
        data: { text, confidence },
      } = await Tesseract.recognize(filePath, "eng", {
        logger: (m) => {
          if (m.status === "recognizing text") {
            sails.log.info(
              `[DocumentProcessor] OCR progress: ${Math.round(m.progress * 100)}%`,
            );
          }
        },
      });

      const cleanText = this._cleanText(text);

      sails.log.info(
        `[DocumentProcessor] OCR complete. Confidence: ${confidence}%, chars: ${cleanText.length}`,
      );

      if (cleanText.length < 20) {
        throw new Error(
          "OCR extracted very little text. Image may be too low quality or contain no readable text.",
        );
      }

      return {
        text: cleanText,
        pageCount: 1,
        metadata: {
          ocrConfidence: confidence,
          fileName: path.basename(filePath),
        },
      };
    } catch (err) {
      sails.log.error(`[DocumentProcessor] Image OCR failed: ${err.message}`);
      throw new Error(`Failed to OCR image: ${err.message}`);
    }
  },

  // ─────────────────────────────────────────────
  // URL / WEBSITE EXTRACTION
  // Uses: axios (fetch HTML) + cheerio (parse)
  // ─────────────────────────────────────────────
  async extractFromUrl(url) {
    try {
      const cheerio = require("cheerio");

      sails.log.info(`[DocumentProcessor] Fetching URL: ${url}`);

      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; KnowledgeBaseBot/1.0)",
        },
      });

      const $ = cheerio.load(response.data);

      // Remove elements that are not content
      $(
        "script, style, nav, header, footer, aside, iframe, noscript, .cookie-banner, .ad, .advertisement",
      ).remove();

      // Extract clean text from body
      const title = $("title").text().trim() || url;
      const text = $("body").text();

      const cleanText = this._cleanText(text);

      sails.log.info(
        `[DocumentProcessor] URL extracted: ${cleanText.length} chars from ${url}`,
      );

      if (cleanText.length < 100) {
        throw new Error(
          "Extracted very little content from the URL. The page may require JavaScript or login.",
        );
      }

      return {
        text: cleanText,
        pageCount: 1,
        metadata: {
          sourceUrl: url,
          pageTitle: title,
          fetchedAt: new Date().toISOString(),
        },
      };
    } catch (err) {
      if (err.response) {
        throw new Error(
          `URL fetch failed with status ${err.response.status}: ${url}`,
        );
      }
      sails.log.error(
        `[DocumentProcessor] URL extraction failed: ${err.message}`,
      );
      throw new Error(`Failed to extract URL: ${err.message}`);
    }
  },

  // ─────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────

  /**
   * Clean raw extracted text:
   * - Remove excessive whitespace
   * - Remove null bytes and weird control characters
   * - Normalize newlines
   */
  _cleanText(text) {
    return text
      .replace(/\x00/g, "") // remove null bytes
      .replace(/\r\n/g, "\n") // normalize windows newlines
      .replace(/\r/g, "\n") // normalize old mac newlines
      .replace(/\t/g, " ") // tabs to spaces
      .replace(/[ ]{3,}/g, "  ") // max 2 consecutive spaces
      .replace(/\n{4,}/g, "\n\n\n") // max 3 consecutive newlines
      .trim();
  },

  /**
   * Strip Markdown formatting symbols for cleaner text
   * Removes: #, *, _, `, >, -, [], ()
   */
  _stripMarkdown(text) {
    return text
      .replace(/^#{1,6}\s+/gm, "") // headings
      .replace(/\*\*(.*?)\*\*/g, "$1") // bold
      .replace(/\*(.*?)\*/g, "$1") // italic
      .replace(/`{3}[\s\S]*?`{3}/g, "") // code blocks
      .replace(/`([^`]+)`/g, "$1") // inline code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links → just text
      .replace(/^>\s+/gm, "") // blockquotes
      .replace(/^[-*+]\s+/gm, "") // unordered lists
      .replace(/^\d+\.\s+/gm, "") // ordered lists
      .replace(/^---+$/gm, "") // horizontal rules
      .replace(/^\s*\|.*\|\s*$/gm, "") // tables
      .trim();
  },
};
