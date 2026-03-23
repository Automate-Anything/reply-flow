declare module 'nodemailer/lib/mail-composer/index.js' {
  interface Address {
    name?: string;
    address: string;
  }

  interface MailComposerOptions {
    from?: string | Address;
    to?: string | Address | (string | Address)[];
    cc?: string | Address | (string | Address)[];
    bcc?: string | Address | (string | Address)[];
    subject?: string;
    html?: string;
    text?: string;
    inReplyTo?: string;
    references?: string | string[];
    headers?: Record<string, string>;
  }

  class MailComposer {
    constructor(options: MailComposerOptions);
    compile(): {
      build(): Promise<Buffer>;
      build(callback: (err: Error | null, message: Buffer) => void): void;
    };
  }

  export default MailComposer;
}
