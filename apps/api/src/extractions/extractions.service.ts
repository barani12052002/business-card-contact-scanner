import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { Express } from 'express';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { recognize } from 'tesseract.js';
import {
  parseBusinessCardText,
  parseVoiceContactText,
  type ParsedContactDraft,
} from './contact-text-parser';
import { createBusinessCardOcrVariants } from './business-card-image-processor';

type ExtractionSource = 'business_card' | 'voice';
const execFileAsync = promisify(execFile);

@Injectable()
export class ExtractionsService {
  private readonly logger = new Logger(ExtractionsService.name);

async extractBusinessCard(file?: any, rawText?: string) {
  if (rawText?.trim()) {
    return this.toExtractionResult(
      "business_card",
      rawText,
      parseBusinessCardText(rawText),
      false,
    );
  }

  if (!file) {
    return this.toExtractionResult(
      "business_card",
      "",
      parseBusinessCardText(""),
      false,
    );
  }

  const result = await this.recognizeBusinessCard(file);

  return {
    ...this.toExtractionResult(
      "business_card",
      result.text,
      parseBusinessCardText(result.text),
      true,
    ),
    processedImage: result.processedImage,
    detectedImage: result.detectedImage,
  };
}

 async extractVoice(file: any, transcript?: string) {
  this.logger.log("VOICE REQUEST RECEIVED");

  const text =
    transcript?.trim() || (file ? await this.transcribeVoice(file) : "");

  this.logger.log(`TRANSCRIBED TEXT: ${text}`);

  const draft = parseVoiceContactText(text);

  this.logger.log(JSON.stringify(draft));

  return this.toExtractionResult(
    "voice",
    text,
    draft,
    Boolean(file),
  );
}

  private async transcribeVoice(file:any) {
    const extension =
      extname(file.originalname || '') || this.extensionForMime(file.mimetype);
    const audioPath = join(
      tmpdir(),
      `bhumio-voice-${Date.now()}-${Math.round(Math.random() * 1_000_000)}${extension}`,
    );

    await fs.writeFile(audioPath, file.buffer);

    try {
      const scriptPath = await this.resolveLocalSttScriptPath();
      const python = process.env.LOCAL_STT_PYTHON ?? 'python';
      const args = [scriptPath, audioPath];

      if (process.env.LOCAL_STT_MODEL) {
        args.push('--model', process.env.LOCAL_STT_MODEL);
      }

      if (process.env.LOCAL_STT_MODEL_DIR) {
        args.push('--model-dir', process.env.LOCAL_STT_MODEL_DIR);
      }

      const { stdout } = await execFileAsync(python, args, {
        timeout: Number(process.env.LOCAL_STT_TIMEOUT_MS ?? '120000'),
        maxBuffer: 1024 * 1024,
      });
      const result = JSON.parse(stdout) as {
        ok: boolean;
        text?: string;
        error?: string;
      };

      if (!result.ok) {
        throw new ServiceUnavailableException(
          result.error ?? 'Local STT failed',
        );
      }

      return result.text?.trim() ?? '';
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        error instanceof Error ? error.message : 'Local STT unavailable',
      );
    } finally {
      await fs.rm(audioPath, { force: true });
    }
  }

  private extensionForMime(mimetype?: string) {
    if (mimetype?.includes('jpeg')) return '.jpg';
    if (mimetype?.includes('jpg')) return '.jpg';
    if (mimetype?.includes('png')) return '.png';
    if (mimetype?.includes('webp')) return '.webp';
    if (mimetype?.includes('webm')) return '.webm';
    if (mimetype?.includes('ogg')) return '.ogg';
    if (mimetype?.includes('mpeg')) return '.mp3';
    if (mimetype?.includes('wav')) return '.wav';
    return '.webm';
  }

  private async resolveLocalSttScriptPath() {
    const candidates = [
      join(process.cwd(), 'scripts', 'local_stt_faster_whisper.py'),
      join(process.cwd(), '..', '..', 'scripts', 'local_stt_faster_whisper.py'),
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'scripts',
        'local_stt_faster_whisper.py',
      ),
    ];

    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Try the next likely project root.
      }
    }

    return candidates[0];
  }

private async recognizeBusinessCard(file: any) {
  return await this.recognizeBusinessCardWithTesseract(file);
}

  private async recognizeBusinessCardWithPaddle(file: any) {
    const extension =
      extname(file.originalname || '') || this.extensionForMime(file.mimetype);
    const imagePath = join(
      tmpdir(),
      `bhumio-card-${Date.now()}-${Math.round(Math.random() * 1_000_000)}${extension}`,
    );
    const outputPath = join(
      tmpdir(),
      `bhumio-card-ocr-${Date.now()}-${Math.round(Math.random() * 1_000_000)}.json`,
    );

    await fs.writeFile(imagePath, file.buffer);

    try {
      const scriptPath = await this.resolvePaddleOcrScriptPath();
      const python =
        process.env.BUSINESS_CARD_OCR_PYTHON ??
        process.env.LOCAL_STT_PYTHON ??
        'python';
      const sideLen = process.env.BUSINESS_CARD_PADDLE_SIDE_LEN ?? '960';
      const { stdout, stderr } = await execFileAsync(
        python,
        [scriptPath, '--output', outputPath, '--side-len', sideLen, imagePath],
        {
          cwd: process.cwd(),
          timeout: Number(process.env.BUSINESS_CARD_OCR_TIMEOUT_MS ?? '180000'),
          maxBuffer: 1024 * 1024 * 20,
          env: {
            ...process.env,
            PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT: '0',
            PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: 'True',
          },
        },
      );

      if (stdout.trim()) {
        this.logger.debug(stdout.trim());
      }

      if (stderr.trim()) {
        this.logger.debug(stderr.trim());
      }

      const payload = JSON.parse(await fs.readFile(outputPath, 'utf8')) as Record<
        string,
        { rawText?: string; lines?: Array<{ text?: string }> }
      >;
      const result = payload[basename(imagePath)];
      const lineText =
        result?.lines
          ?.map((line) => line.text?.trim())
          .filter(Boolean)
          .join('\n') ?? '';
      const rawText = result?.rawText?.trim() || lineText;

      if (!rawText) {
        throw new Error('PaddleOCR returned no text');
      }

      return `--- paddle ---\n${rawText}`;
    } finally {
      await Promise.all([
        fs.rm(imagePath, { force: true }),
        fs.rm(outputPath, { force: true }),
      ]);
    }
  }
private async recognizeBusinessCardWithTesseract(file: any) {
  this.logger.log("========== OCR START ==========");

  const extension =
    extname(file.originalname || "") || this.extensionForMime(file.mimetype);

  const imagePath = join(
    tmpdir(),
    `business-card-${Date.now()}${extension}`,
  );

  await fs.writeFile(imagePath, file.buffer);

  let processedImagePath = imagePath;

  try {
    const python =
      process.env.BUSINESS_CARD_OCR_PYTHON ??
      process.env.LOCAL_STT_PYTHON ??
      "python3";

    const scriptPath = await this.resolveOpenCvScriptPath();

    this.logger.log("Running OpenCV edge detection...");

    const { stdout } = await execFileAsync(
      python,
      [scriptPath, imagePath],
      {
        timeout: 120000,
      },
    );

    processedImagePath = stdout.trim();

this.logger.log(`OpenCV Output : ${processedImagePath}`);

const exists = await fs
  .access(processedImagePath)
  .then(() => true)
  .catch(() => false);

this.logger.log(`Processed image exists: ${exists}`);

const previewPath = processedImagePath.replace(
  ".opencv.png",
  ".detected.png",
);

const previewExists = await fs
  .access(previewPath)
  .then(() => true)
  .catch(() => false);

this.logger.log(`Detected image exists: ${previewExists}`);

const imageBuffer = await fs.readFile(processedImagePath);

this.logger.log("Running Tesseract OCR...");
    const variants = await createBusinessCardOcrVariants(imageBuffer);

    let bestText = "";

    for (const variant of variants) {
      const result = await recognize(variant.buffer, "eng");

      if (result.data.text.length > bestText.length) {
        bestText = result.data.text;
      }
    }

    this.logger.log("========== OCR END ==========");

    return {
  text: bestText,
  processedImage: `/uploads/processed/${basename(processedImagePath)}`,
  detectedImage: `/uploads/processed/${basename(previewPath)}`,

};
  } finally {
    await fs.rm(imagePath, { force: true });

   // if (processedImagePath !== imagePath) {
     // await fs.rm(processedImagePath, { force: true });

     // const preview = processedImagePath.replace(
     //   ".opencv.png",
     //   ".detected.png",
    //  );

     // await fs.rm(preview, { force: true });
   // }
  }
}

  private async resolvePaddleOcrScriptPath() {
    const candidates = [
      join(process.cwd(), 'scripts', 'paddle_ocr_bridge.py'),
      join(process.cwd(), '..', '..', 'scripts', 'paddle_ocr_bridge.py'),
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'scripts',
        'paddle_ocr_bridge.py',
      ),
    ];

    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Try the next likely project root.
      }
    }

    return candidates[0];
  }

 private async resolveOpenCvScriptPath() {
  const candidates = [
    join(process.cwd(), "scripts", "opencv_preprocess_bridge.py"),
    join(process.cwd(), "..", "..", "scripts", "opencv_preprocess_bridge.py"),
    join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "scripts",
      "opencv_preprocess_bridge.py",
    ),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }

  throw new Error("opencv_preprocess_bridge.py not found");
}
  private toExtractionResult(
    sourceType: ExtractionSource,
    rawText: string,
    draft: ParsedContactDraft,
    fileReceived: boolean,
  ) {
    return {
      sourceType,
      rawText,
      draft,
      fileReceived,
    };
  }
}