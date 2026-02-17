import { getAddressEncoder, type Address } from '@solana/kit';

const encoder = getAddressEncoder();

export class BorshWriter {
  private data: number[] = [];

  bytes(value: Uint8Array | number[]): this {
    this.data.push(...value);
    return this;
  }

  u8(value: number): this {
    this.data.push(value & 0xff);
    return this;
  }

  u16(value: number): this {
    const buf = new ArrayBuffer(2);
    new DataView(buf).setUint16(0, value, true);
    this.data.push(...new Uint8Array(buf));
    return this;
  }

  u64(value: bigint): this {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setBigUint64(0, value, true);
    this.data.push(...new Uint8Array(buf));
    return this;
  }

  i64(value: bigint): this {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setBigInt64(0, value, true);
    this.data.push(...new Uint8Array(buf));
    return this;
  }

  bool(value: boolean): this {
    this.data.push(value ? 1 : 0);
    return this;
  }

  string(value: string): this {
    const encoded = new TextEncoder().encode(value);
    this.u32(encoded.length);
    this.data.push(...encoded);
    return this;
  }

  pubkey(value: Address): this {
    this.data.push(...encoder.encode(value));
    return this;
  }

  option<T>(value: T | undefined | null, writer: (v: T) => void): this {
    if (value != null) {
      this.u8(1);
      writer(value);
    } else {
      this.u8(0);
    }
    return this;
  }

  vec<T>(items: T[], writer: (v: T) => void): this {
    this.u32(items.length);
    for (const item of items) {
      writer(item);
    }
    return this;
  }

  private u32(value: number): void {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setUint32(0, value, true);
    this.data.push(...new Uint8Array(buf));
  }

  toBuffer(): Uint8Array {
    return new Uint8Array(this.data);
  }
}

export class BorshReader {
  private view: DataView;
  private offset = 0;

  constructor(data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  skip(n: number): this {
    this.offset += n;
    return this;
  }

  u8(): number {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  u16(): number {
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  u64(): bigint {
    const value = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return value;
  }

  i64(): bigint {
    const value = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return value;
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  string(): string {
    const len = this.view.getUint32(this.offset, true);
    this.offset += 4;
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, len);
    this.offset += len;
    return new TextDecoder().decode(bytes);
  }

  pubkey(): Address {
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, 32);
    this.offset += 32;
    const { getAddressDecoder } = require('@solana/kit') as typeof import('@solana/kit');
    return getAddressDecoder().decode(bytes);
  }

  bytes(n: number): Uint8Array {
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, n);
    this.offset += n;
    return bytes;
  }
}
