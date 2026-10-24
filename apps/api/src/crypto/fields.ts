import { fieldAad, openText, sealText, type Bytes } from './aead.ts';
import type { WorkspaceKeys } from './keys.ts';

/** Encrypts and decrypts the personal fields of one workspace. */
export class FieldCipher {
  constructor(private readonly keys: WorkspaceKeys) {}

  async enc(
    table: string,
    column: string,
    rowId: string,
    text: string | null | undefined,
  ): Promise<Buffer | null> {
    if (text === null || text === undefined) return null;
    return Buffer.from(await sealText(this.keys.data, text, fieldAad(table, column, rowId)));
  }

  async dec(
    table: string,
    column: string,
    rowId: string,
    blob: Uint8Array | null | undefined,
  ): Promise<string | null> {
    if (blob === null || blob === undefined) return null;
    const copy: Bytes = Uint8Array.from(blob); // pg hands back Buffers, which may sit on a shared pool
    return openText(this.keys.data, copy, fieldAad(table, column, rowId));
  }
}
