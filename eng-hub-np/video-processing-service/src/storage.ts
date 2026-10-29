import { Storage } from "@google-cloud/storage";
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";

const storage = new Storage();

const rawVideoBucketName = "codeyalaya-yt-raw-videos";
const processedVideoBucketName = "codeyalaya-yt-processed-videos";

const localRawVideoPath = "./raw-videos";
const localProcessedVideoPath = "./processed-videos";

/**
 * Creates the local directories for raw and processed videos.
 */
export function setupDirectories() {
  ensureDirectoryExistence(localRawVideoPath);
  ensureDirectoryExistence(localProcessedVideoPath);
}

// --- HLS Adaptive Streaming ---

interface HlsVariant {
  name: string; // e.g. "360p"
  height: number; // e.g. 360
  videoBitrate: string; // e.g. "800k"
  audioBitrate: string; // e.g. "96k"
  maxrate: string; // e.g. "856k"
  bufsize: string; // e.g. "1200k"
  bandwidth: number; // bits/sec for master playlist, e.g. 800000
}

const HLS_VARIANTS: HlsVariant[] = [
  {
    name: "360p",
    height: 360,
    videoBitrate: "800k",
    audioBitrate: "96k",
    maxrate: "856k",
    bufsize: "1200k",
    bandwidth: 800000,
  },
  {
    name: "480p",
    height: 480,
    videoBitrate: "1400k",
    audioBitrate: "128k",
    maxrate: "1498k",
    bufsize: "2100k",
    bandwidth: 1400000,
  },
  {
    name: "720p",
    height: 720,
    videoBitrate: "2800k",
    audioBitrate: "128k",
    maxrate: "2996k",
    bufsize: "4200k",
    bandwidth: 2800000,
  },
];

/**
 * Transcodes a single HLS variant (e.g. 360p) from the raw video.
 * Produces a directory like ./processed-videos/<videoId>/360p/
 * containing playlist.m3u8 and segment*.ts files.
 */
function transcodeVariant(
  rawVideoPath: string,
  outputDir: string,
  variant: HlsVariant,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const variantDir = path.join(outputDir, variant.name);
    ensureDirectoryExistence(variantDir);

    const playlistPath = path.join(variantDir, "playlist.m3u8");
    const segmentPattern = path.join(variantDir, "segment%03d.ts");

    ffmpeg(rawVideoPath)
      .outputOptions([
        "-vf",
        `scale=-2:${variant.height}`,
        "-c:v",
        "libx264",
        "-b:v",
        variant.videoBitrate,
        "-maxrate",
        variant.maxrate,
        "-bufsize",
        variant.bufsize,
        "-c:a",
        "aac",
        "-b:a",
        variant.audioBitrate,
        "-ar",
        "48000",
        "-hls_time",
        "6",
        "-hls_playlist_type",
        "vod",
        "-hls_segment_filename",
        segmentPattern,
        "-f",
        "hls",
      ])
      .on("end", () => {
        console.log(`Transcoding ${variant.name} finished.`);
        resolve();
      })
      .on("error", (err) => {
        console.error(`Transcoding ${variant.name} failed: ${err.message}`);
        reject(err);
      })
      .save(playlistPath);
  });
}

/**
 * Generates the master M3U8 playlist that references all variant playlists.
 */
function generateMasterPlaylist(outputDir: string): void {
  let content = "#EXTM3U\n#EXT-X-VERSION:3\n\n";

  for (const variant of HLS_VARIANTS) {
    // Calculate width from height assuming 16:9 aspect ratio
    const width = Math.round((variant.height * 16) / 9);
    // Ensure width is even (required by x264)
    const evenWidth = width % 2 === 0 ? width : width + 1;

    content += `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},RESOLUTION=${evenWidth}x${variant.height}\n`;
    content += `${variant.name}/playlist.m3u8\n\n`;
  }

  fs.writeFileSync(path.join(outputDir, "master.m3u8"), content);
  console.log("Master playlist generated.");
}

/**
 * Full adaptive streaming pipeline:
 * 1. Transcode raw video into 360p, 480p, and 720p HLS variants (sequentially to limit resource usage).
 * 2. Generate a master.m3u8 playlist.
 * Returns the path to the output directory.
 *
 * @param rawVideoName - Filename inside ./raw-videos/
 * @param videoId - Unique identifier used as the output folder name.
 */
export async function convertVideoToHls(
  rawVideoName: string,
  videoId: string,
): Promise<string> {
  const rawVideoPath = `${localRawVideoPath}/${rawVideoName}`;
  const outputDir = path.join(localProcessedVideoPath, videoId);
  ensureDirectoryExistence(outputDir);

  // Transcode each variant sequentially to avoid overwhelming the CPU
  for (const variant of HLS_VARIANTS) {
    await transcodeVariant(rawVideoPath, outputDir, variant);
  }

  generateMasterPlaylist(outputDir);
  return outputDir;
}

/**
 * Uploads the entire HLS output directory to Cloud Storage.
 * Preserves the folder structure:
 *   <videoId>/master.m3u8
 *   <videoId>/360p/playlist.m3u8
 *   <videoId>/360p/segment000.ts
 *   ...
 *
 * Sets correct Content-Type headers so browsers can fetch segments directly.
 */
export async function uploadHlsOutput(
  localDir: string,
  videoId: string,
): Promise<void> {
  const bucket = storage.bucket(processedVideoBucketName);

  async function uploadRecursive(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await uploadRecursive(fullPath);
      } else {
        const destination = path.relative(localProcessedVideoPath, fullPath);

        // Determine Content-Type and Cache-Control
        let contentType = "application/octet-stream";
        let cacheControl = "public, max-age=86400"; // Default: 24 hours

        if (entry.name.endsWith(".m3u8")) {
          contentType = "application/vnd.apple.mpegurl";
          // Playlists are small and should be fresh, short cache
          cacheControl = "public, max-age=60, s-maxage=300";
        } else if (entry.name.endsWith(".ts")) {
          contentType = "video/mp2t";
          // Segments are immutable once written, long cache
          cacheControl = "public, max-age=604800, immutable";
        }

        await bucket.upload(fullPath, {
          destination,
          metadata: {
            contentType,
            cacheControl,
          },
        });
      }
    }
  }

  await uploadRecursive(localDir);

  // const [files] = await bucket.getFiles({ prefix: `${videoId}/` });
  // await Promise.all(files.map((file) => file.makePublic()));

  // console.log(`HLS output for ${videoId} uploaded and made public.`);
  console.log(`HLS output for ${videoId} uploaded.`);
}

/**
 * Deletes the entire local HLS output directory for a video.
 */
export function deleteHlsOutput(videoId: string): Promise<void> {
  const dir = path.join(localProcessedVideoPath, videoId);
  return new Promise((resolve) => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`Deleted HLS output at ${dir}`);
    }
    resolve();
  });
}

// --- Original helpers (unchanged) ---

/**
 * @param fileName - The name of the file to download from the
 * {@link rawVideoBucketName} bucket into the {@link localRawVideoPath} folder.
 * @returns A promise that resolves when the file has been downloaded.
 */
export async function downloadRawVideo(fileName: string) {
  await storage
    .bucket(rawVideoBucketName)
    .file(fileName)
    .download({ destination: `${localRawVideoPath}/${fileName}` });

  console.log(
    `gs://${rawVideoBucketName}/${fileName} downloaded to ${localRawVideoPath}/${fileName}.`,
  );
}

/**
 * @param fileName - The name of the file to delete from the
 * {@link localRawVideoPath} folder.
 * @returns A promise that resolves when the file has been deleted.
 */
export function deleteRawVideo(fileName: string) {
  return deleteFile(`${localRawVideoPath}/${fileName}`);
}

/**
 * @param filePath - The path of the file to delete.
 * @returns A promise that resolves when the file has been deleted.
 */
function deleteFile(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, (err) => {
        if (err) {
          console.log(`Failed to delete file at ${filePath}`, err);
          reject(err);
        } else {
          console.log(`File deleted at ${filePath}`);
          resolve();
        }
      });
    } else {
      console.log(`File not found at ${filePath}, skipping the delete.`);
      resolve();
    }
  });
}

/**
 * Ensures a directory exists, creating it if necessary.
 * @param {string} dirPath - The directory path to check.
 */
function ensureDirectoryExistence(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Directory created at ${dirPath}`);
  }
}
