export type LocalFileSystemPermissionMode = "read" | "readwrite";

export type LocalFileSystemPermissionState = "granted" | "denied" | "prompt";

export interface LocalFileSystemPermissionDescriptor {
  mode: LocalFileSystemPermissionMode;
}

export interface LocalFileSystemWritableFileStream {
  write(data: string | Uint8Array | ArrayBuffer | Blob): Promise<void> | void;
  close(): Promise<void> | void;
  abort?(): Promise<void> | void;
}

export interface LocalFileSystemFileHandle {
  readonly kind?: "file";
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<LocalFileSystemWritableFileStream>;
  queryPermission?(
    descriptor: LocalFileSystemPermissionDescriptor,
  ): Promise<LocalFileSystemPermissionState>;
  requestPermission?(
    descriptor: LocalFileSystemPermissionDescriptor,
  ): Promise<LocalFileSystemPermissionState>;
}
