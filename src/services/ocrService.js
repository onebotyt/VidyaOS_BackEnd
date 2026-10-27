/**
 * ══════════════════════════════════════════════════════════════
 * OCR & QUESTION PAPER PARSER SERVICE
 * backend/src/services/ocrService.js
 * ══════════════════════════════════════════════════════════════
 * Intelligently extracts questions, instructions, and max marks
 * from academic question papers (PDFs and scanned/camera images).
 * Filters out college headers, CO tables, Bloom's rubrics, etc.
 */

const { PDFParse } = require('pdf-parse');
const Tesseract = require('tesseract.js');
const logger = require('../utils/logger');

class OcrService {
  /**
   * Cleans trailing table column metadata and Bloom's taxonomy notes
   * from an individual question string.
   */
  cleanQuestionText(text) {
    if (!text) return '';
    return text
      .replace(/\s*\(\s*1\s*[-–]\s*Remembering.*$/i, '')
      .replace(/\s*--\s*\d+\s+of\s+\d+\s*--.*$/i, '')
      .replace(/\s+\d+(\.\d+)?\s+CO\d+.*$/i, '')
      .replace(/\s+CO\d+.*$/i, '')
      .replace(/\s+\d+(\.\d+)?$/g, '') // remove trailing standalone marks column
      .trim();
  }

  /**
   * Parses raw extracted document text to isolate pure questions,
   * instructions, and total marks.
   */
  parseQuestionsAndMetadata(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      return {
        detectedMaxMarks: null,
        instructions: [],
        questions: [],
        formattedText: ''
      };
    }

    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    // 1. Detect Maximum / Total Marks
    let detectedMaxMarks = null;
    for (const line of lines) {
      const m = line.match(/(?:Maximum\s*Marks|Total\s*Marks)\s*[:=]?\s*(\d+)/i);
      if (m) {
        detectedMaxMarks = parseInt(m[1], 10);
        break;
      }
    }

    // 2. Extract Instruction Statements
    const instructions = [];
    for (const line of lines) {
      if (
        /^(?:Attempt\b|Each question\b|All questions\b|Note\b|Instructions\b)/i.test(line) &&
        !line.includes("Bloom") &&
        !line.includes("Taxonomy")
      ) {
        const cleanedInstruction = line.replace(/^Instructions?\s*[:\-]?\s*/i, '').trim();
        if (cleanedInstruction && !instructions.includes(cleanedInstruction)) {
          instructions.push(cleanedInstruction);
        }
      }
    }

    // 3. Extract Questions
    const questions = [];
    let currentQ = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Filter out institution headers and examination metadata
      if (/(?:INSTITUTE|POLYTECHNIC|COLLEGE|UNIVERSITY|Examination|Session|Program Name|Course|Duration|Course Outcomes|Bloom's|Performance Indicator|Difficulty level)/i.test(line)) {
        continue;
      }

      // Filter out Course Outcomes (CO) table rows & rubric definitions
      if (/^CO\d+\b/i.test(line) || /^(?:BL|PO|PI|DL)\s*:/i.test(line) || line.includes('Remembering')) {
        continue;
      }

      // Filter out rubric table headers
      if (/(?:Q\.\s*No|Questions|Marks\s+CO)/i.test(line)) {
        continue;
      }

      // Filter out instructions lines already captured
      if (/^(?:Attempt|Total Marks|Each question carries)/i.test(line)) {
        continue;
      }

      // Match question number patterns: "1.", "1)", "Q1.", "Q1:", "Q. 1", "Question 1:"
      const qMatch = line.match(/^(?:Q(?:uestion)?\.?\s*)?(\d+)[\.\:\)\-]\s*(.*)$/i);
      if (qMatch) {
        if (currentQ) {
          currentQ.text = this.cleanQuestionText(currentQ.text);
          if (currentQ.text.length > 0) {
            questions.push(currentQ);
          }
        }
        currentQ = {
          num: parseInt(qMatch[1], 10),
          label: `Q${qMatch[1]}`,
          text: this.cleanQuestionText(qMatch[2])
        };
      } else if (currentQ) {
        // Continuation line of multi-line question
        if (
          !/^(?:BL|CO|PO|PI|DL)\b/i.test(line) &&
          !line.includes("Taxonomy") &&
          !line.includes("Remembering") &&
          !line.includes("--")
        ) {
          const cleanedCont = this.cleanQuestionText(line);
          if (cleanedCont) {
            currentQ.text += (currentQ.text ? ' ' : '') + cleanedCont;
          }
        }
      }
    }

    if (currentQ) {
      currentQ.text = this.cleanQuestionText(currentQ.text);
      if (currentQ.text.length > 0) {
        questions.push(currentQ);
      }
    }

    // Auto-calculate split marks if maxMarks detected and questions found
    if (detectedMaxMarks && questions.length > 0) {
      const splitMark = Math.round((detectedMaxMarks / questions.length) * 10) / 10;
      questions.forEach(q => {
        q.max = splitMark;
      });
    }

    // Compose formatted text for single textarea
    let formattedText = '';
    if (instructions.length > 0) {
      formattedText += 'Instructions:\n' + instructions.map(ins => `- ${ins}`).join('\n') + '\n\n';
    } else {
      formattedText += 'Instructions:\n- Attempt all questions.\n- Each question carries equal marks.\n\n';
    }

    if (questions.length > 0) {
      formattedText += 'Questions:\n' + questions.map((q, idx) => `${idx + 1}. ${q.text}`).join('\n\n');
    }

    return {
      detectedMaxMarks,
      instructions,
      questions,
      formattedText: formattedText.trim()
    };
  }

  /**
   * Main entry point to extract questions from an uploaded document buffer.
   * Supports PDF and Images (JPG, PNG, WebP).
   */
  async extractQuestions(fileBuffer, originalName = '', mimeType = '') {
    try {
      let rawText = '';
      const isPdf = mimeType.includes('pdf') || originalName.toLowerCase().endsWith('.pdf');

      if (isPdf) {
        logger.info(`[OcrService] Parsing PDF: ${originalName} (${fileBuffer.length} bytes)`);
        const parser = new PDFParse({ data: fileBuffer });
        const result = await parser.getText();
        rawText = result.text || '';
      }

      // If not a PDF or if PDF contained no text (e.g. scanned image PDF)
      if (!rawText.trim()) {
        logger.info(`[OcrService] Running Tesseract OCR on ${originalName || 'image'} (${fileBuffer.length} bytes)`);
        const { data } = await Tesseract.recognize(fileBuffer, 'eng', {
          logger: m => {
            if (m.status === 'recognizing text' && m.progress % 0.25 === 0) {
              logger.debug(`[Tesseract OCR] Progress: ${(m.progress * 100).toFixed(0)}%`);
            }
          }
        });
        rawText = data.text || '';
      }

      const parsed = this.parseQuestionsAndMetadata(rawText);
      return {
        success: true,
        rawTextLength: rawText.length,
        ...parsed
      };
    } catch (err) {
      logger.error('[OcrService] extractQuestions error:', { error: err.message });
      throw err;
    }
  }
}

module.exports = new OcrService();
