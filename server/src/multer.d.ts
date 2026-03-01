declare module 'multer' {
  import type { RequestHandler } from 'express';

  interface File {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
  }

  interface StorageEngine {
    _handleFile(req: Express.Request, file: File, callback: (error?: Error | null, info?: Partial<File>) => void): void;
    _removeFile(req: Express.Request, file: File, callback: (error: Error | null) => void): void;
  }

  interface Options {
    storage?: StorageEngine;
    limits?: {
      fileSize?: number;
      files?: number;
      fields?: number;
      fieldNameSize?: number;
      fieldSize?: number;
      parts?: number;
      headerPairs?: number;
    };
    fileFilter?(
      req: Express.Request,
      file: File,
      cb: (error: Error | null, acceptFile?: boolean) => void
    ): void;
  }

  interface Multer {
    single(fieldname: string): RequestHandler;
    array(fieldname: string, maxCount?: number): RequestHandler;
    fields(fields: Array<{ name: string; maxCount?: number }>): RequestHandler;
    none(): RequestHandler;
    any(): RequestHandler;
  }

  interface MulterStatic {
    (options?: Options): Multer;
    memoryStorage(): StorageEngine;
    diskStorage(options: {
      destination?: string | ((req: Express.Request, file: File, cb: (error: Error | null, destination: string) => void) => void);
      filename?(req: Express.Request, file: File, cb: (error: Error | null, filename: string) => void): void;
    }): StorageEngine;
  }

  const multer: MulterStatic;
  export default multer;
}

declare global {
  namespace Express {
    interface Request {
      file?: import('multer').File;
      files?: import('multer').File[] | Record<string, import('multer').File[]>;
    }
  }
}
