const DATABASE_NAME = "x-post-personal-media";
const DATABASE_VERSION = 1;
const BACKGROUND_STORE = "backgrounds";

export const PERSONAL_BACKGROUND_MAX_BYTES = 20 * 1024 * 1024;

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type PersonalBackgroundRecord = {
  id: string;
  name: string;
  blob: Blob;
  createdAt: number;
};

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("浏览器本地存储操作失败")), { once: true });
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("浏览器本地存储操作已取消")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("浏览器本地存储操作失败")), { once: true });
  });
}

function openDatabase() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("当前浏览器不支持本机图片库"));
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(BACKGROUND_STORE)) {
        request.result.createObjectStore(BACKGROUND_STORE, { keyPath: "id" });
      }
    });
    request.addEventListener("success", () => {
      const database = request.result;
      database.addEventListener("versionchange", () => database.close());
      resolve(database);
    }, { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("无法打开浏览器本机图片库")), { once: true });
    request.addEventListener("blocked", () => reject(new Error("浏览器本机图片库正在被其他页面占用")), { once: true });
  });
}

function personalBackgroundName(fileName: string) {
  return fileName.replace(/\.[^.]+$/u, "").trim() || "我的图片";
}

export function validatePersonalBackground(file: File) {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    throw new Error("请选择 JPG、PNG 或 WebP 图片");
  }
  if (file.size <= 0) {
    throw new Error("图片文件为空");
  }
  if (file.size > PERSONAL_BACKGROUND_MAX_BYTES) {
    throw new Error("图片不能超过 20 MB");
  }
}

export async function listPersonalBackgrounds() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(BACKGROUND_STORE, "readonly");
    const complete = transactionComplete(transaction);
    const records = await requestResult(transaction.objectStore(BACKGROUND_STORE).getAll()) as PersonalBackgroundRecord[];
    await complete;
    return records.sort((left, right) => left.createdAt - right.createdAt);
  } finally {
    database.close();
  }
}

export async function savePersonalBackground(file: File) {
  validatePersonalBackground(file);
  const record: PersonalBackgroundRecord = {
    id: `personal-${crypto.randomUUID()}`,
    name: personalBackgroundName(file.name),
    blob: file,
    createdAt: Date.now(),
  };
  const database = await openDatabase();
  try {
    const transaction = database.transaction(BACKGROUND_STORE, "readwrite");
    const complete = transactionComplete(transaction);
    transaction.objectStore(BACKGROUND_STORE).put(record);
    await complete;
    return record;
  } finally {
    database.close();
  }
}

export async function deletePersonalBackground(id: string) {
  if (!id.startsWith("personal-")) throw new Error("只能删除本机图片");
  const database = await openDatabase();
  try {
    const transaction = database.transaction(BACKGROUND_STORE, "readwrite");
    const complete = transactionComplete(transaction);
    transaction.objectStore(BACKGROUND_STORE).delete(id);
    await complete;
  } finally {
    database.close();
  }
}
