declare module "heic-decode" {
  function decode(input: { buffer: Buffer }): Promise<{
    width: number;
    height: number;
    data: ArrayBuffer;
  }>;
  export default decode;
}
