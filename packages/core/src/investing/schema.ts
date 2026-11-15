/** Effect schemas type their decoded value as deeply readonly; the investing
 *  read models are plain mutable JSON, so their derived types strip it. */
export type DeepMutable<T> = T extends readonly (infer Element)[]
  ? DeepMutable<Element>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;
