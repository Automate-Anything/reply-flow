import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

// Point fluent-ffmpeg to the bundled static binary
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/**
 * Converts an audio buffer (any browser-native format) to OGG/Opus.
 * Returns the converted OGG buffer.
 * Temp files are cleaned up in all cases (success or failure).
 */
export async function convertToOggOpus(
  inputBuffer: Buffer,
  messageId: string,
  inputMimeType: string,
): Promise<Buffer> {
  const ext = mimeToInputExt(inputMimeType);
  const inputPath = path.join(os.tmpdir(), `voice-${messageId}-input${ext}`);
  const outputPath = path.join(os.tmpdir(), `voice-${messageId}-output.ogg`);

  try {
    await fs.writeFile(inputPath, inputBuffer);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .audioCodec('libopus')
        .audioBitrate('64k')
        .format('ogg')
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(new Error(`ffmpeg conversion failed: ${err.message}`)))
        .run();
    });

    const outputBuffer = await fs.readFile(outputPath);
    return outputBuffer;
  } finally {
    // Clean up temp files regardless of success/failure
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

function mimeToInputExt(mimeType: string): string {
  const map: Record<string, string> = {
    'audio/webm': '.webm',
    'audio/mp4': '.mp4',
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
    'audio/aac': '.aac',
    'audio/wav': '.wav',
    'audio/x-m4a': '.m4a',
    'video/webm': '.webm', // some browsers report video/webm for audio-only
  };
  return map[mimeType] || '.webm';
}
