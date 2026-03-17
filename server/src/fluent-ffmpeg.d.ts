declare module 'fluent-ffmpeg' {
  interface FfmpegCommand {
    audioCodec(codec: string): FfmpegCommand;
    audioBitrate(bitrate: string): FfmpegCommand;
    format(format: string): FfmpegCommand;
    output(path: string): FfmpegCommand;
    on(event: 'end', callback: () => void): FfmpegCommand;
    on(event: 'error', callback: (err: Error) => void): FfmpegCommand;
    run(): void;
  }

  interface FfmpegStatic {
    (input: string): FfmpegCommand;
    setFfmpegPath(path: string): void;
  }

  const ffmpeg: FfmpegStatic;
  export default ffmpeg;
}

declare module '@ffmpeg-installer/ffmpeg' {
  export const path: string;
}
