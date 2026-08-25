import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { contentHash, parseXStatusUrl, stableUuid } from "../packages/material-pipeline/index.mjs";

export const SOURCE_MAP = new Map([
  ["rwayne", { handle: "rwayne", displayName: "rwayne", avatar: "avatars/rwayne.png" }],
  ["黄小木", { handle: "ai_xiaomu", displayName: "黄小木", avatar: "avatars/ai-xiaomu-2076716603392323584.png" }],
  ["AI最严厉的父亲", { handle: "dashen_wang", displayName: "AI最严厉的父亲", avatar: "avatars/dashen-wang.jpg" }],
  ["阿川 | AI thinking", { handle: "AI_jacksaku", displayName: "阿川 | AI thinking", avatar: "avatars/ai-jacksaku.jpg" }],
]);

const BACKGROUND_NAMES = {
  "ny-sunset.jpg": "纽约落日",
  "hongkong-neon.jpg": "香港霓虹",
  "itadaki-city-night.jpg": "城市夜幕",
  "beijing-bluehour.jpg": "北京蓝调时刻",
  "sunny-city-blue-sky.jpg": "晴日蓝天",
  "sunny-city-clouds.jpg": "晴日云城",
  "sunset-city-water.jpg": "落日水岸",
  "sunset-city-glass.jpg": "落日街景",
  "alpine-clouds.jpg": "云下雪峰",
  "alpine-clear-sky.jpg": "蓝天雪峰",
};

const BACKGROUND_SOURCES = {
  "sunny-city-blue-sky.jpg": ["https://www.pexels.com/photo/modern-urban-skyline-with-blue-sky-view-33244792/", "Pexels License"],
  "sunny-city-clouds.jpg": ["https://unsplash.com/photos/white-clouds-and-blue-sky-85Km1bnKUOE", "Unsplash License"],
  "sunset-city-water.jpg": ["https://www.pexels.com/photo/a-sunset-over-the-city-skyline-with-buildings-reflected-in-the-water-28216080/", "Pexels License"],
  "sunset-city-glass.jpg": ["https://www.pexels.com/photo/28351176/", "Pexels License"],
  "alpine-clouds.jpg": ["https://images.pexels.com/photos/27821966/pexels-photo-27821966.jpeg", "Pexels License"],
  "alpine-clear-sky.jpg": ["https://www.pexels.com/photo/snowy-alpine-peaks-under-clear-blue-sky-36980067/", "Pexels License"],
};

function gitValue(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

async function fileRecord(filePath, objectKey) {
  const [bytes, info] = await Promise.all([readFile(filePath), stat(filePath)]);
  return {
    sourcePath: path.relative(process.cwd(), filePath),
    objectKey,
    bytes: info.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function imageMetadata(bytes, filePath) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mimeType: "image/png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { mimeType: "image/jpeg", height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  throw new Error(`Unsupported or invalid image: ${filePath}`);
}

async function imageRecord(filePath, objectKey) {
  const [bytes, info] = await Promise.all([readFile(filePath), stat(filePath)]);
  return {
    sourcePath: path.relative(process.cwd(), filePath),
    objectKey,
    bytes: info.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...imageMetadata(bytes, filePath),
  };
}

export async function loadMigrationBundle() {
  const sourceCommit = gitValue(["rev-parse", "HEAD"]);
  const sourceCommitDate = gitValue(["show", "-s", "--format=%cI", "HEAD"]);
  const materialsPath = path.resolve("app/data/existing-materials.json");
  const accountsPath = path.resolve("app/data/existing-accounts.json");
  const [materialsRaw, accountsRaw] = await Promise.all([readFile(materialsPath, "utf8"), readFile(accountsPath, "utf8")]);
  const materials = JSON.parse(materialsRaw);
  const accounts = JSON.parse(accountsRaw);

  const duplicateIds = [];
  const seen = new Set();
  const invalidLinks = [];
  const authorCounts = {};
  const categoryCounts = {};

  const normalizedMaterials = materials.map((material) => {
    if (seen.has(material.id)) duplicateIds.push(material.id);
    seen.add(material.id);
    let parsed;
    try {
      parsed = parseXStatusUrl(material.link);
    } catch {
      invalidLinks.push(material.link);
      return null;
    }
    const source = SOURCE_MAP.get(material.source);
    if (!source) throw new Error(`Unknown material source: ${material.source}`);
    if (parsed.handle.toLowerCase() !== source.handle.toLowerCase()) {
      throw new Error(`Handle mismatch for ${material.id}: ${parsed.handle} != ${source.handle}`);
    }
    authorCounts[material.source] = (authorCounts[material.source] ?? 0) + 1;
    categoryCounts[material.category] = (categoryCounts[material.category] ?? 0) + 1;
    return {
      ...material,
      platformPostId: parsed.platformPostId,
      sourceAuthor: source,
      contentHash: contentHash(material.text),
      databaseId: stableUuid("material", parsed.platformPostId),
    };
  }).filter(Boolean);

  const backgroundNames = (await readdir(path.resolve("public/backgrounds"))).filter((file) => !file.startsWith(".")).sort();
  const avatarNames = (await readdir(path.resolve("public/avatars"))).filter((file) => !file.startsWith(".")).sort();
  const backgrounds = [];
  for (const file of backgroundNames) {
    const filePath = path.resolve("public/backgrounds", file);
    const source = BACKGROUND_SOURCES[file] ?? [null, "Existing project asset; provenance retained from repository history"];
    backgrounds.push({
      ...(await imageRecord(filePath, `backgrounds/${file}`)),
      id: stableUuid("background", file),
      title: BACKGROUND_NAMES[file] ?? path.parse(file).name,
      sourceUrl: source[0],
      licenseNote: source[1],
    });
  }
  const avatars = [];
  for (const file of avatarNames) {
    const filePath = path.resolve("public/avatars", file);
    avatars.push(await imageRecord(filePath, `avatars/${file}`));
  }

  const sourceFiles = await Promise.all([
    fileRecord(materialsPath, "source/existing-materials.json"),
    fileRecord(accountsPath, "source/existing-accounts.json"),
  ]);
  const manifestCore = {
    schemaVersion: "1",
    sourceCommit,
    sourceCommitDate,
    counts: { materials: normalizedMaterials.length, accounts: accounts.length, backgrounds: backgrounds.length, avatars: avatars.length },
    authorCounts,
    categoryCounts,
    duplicateIds,
    invalidLinks,
    files: [...sourceFiles, ...backgrounds, ...avatars].map(({ sourcePath, objectKey, bytes, sha256 }) => ({ sourcePath, objectKey, bytes, sha256 })),
  };
  const manifestSha256 = createHash("sha256").update(JSON.stringify(manifestCore)).digest("hex");
  return {
    ...manifestCore,
    manifestSha256,
    importBatchId: stableUuid("import-batch", `${sourceCommit}:${manifestSha256}`),
    materials: normalizedMaterials,
    accounts,
    backgrounds,
    avatars,
  };
}
