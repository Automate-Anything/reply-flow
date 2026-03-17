declare module 'jsonwebtoken' {
  interface JwtPayload {
    [key: string]: unknown;
  }

  function sign(payload: string | object | Buffer, secret: string, options?: object): string;
  function verify(token: string, secret: string, options?: object): string | JwtPayload;
  function decode(token: string, options?: object): string | JwtPayload | null;

  export { sign, verify, decode, JwtPayload };
}
