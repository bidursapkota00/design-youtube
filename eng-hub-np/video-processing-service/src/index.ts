import express from "express";
import {
  setupDirectories,
  downloadRawVideo,
  convertVideoToHls,
  uploadHlsOutput,
  deleteRawVideo,
  deleteHlsOutput,
} from "./storage.js";
import { isVideoNew, setVideo } from "./firestore.js";

setupDirectories();

const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;

app.post("/process-video", async (req, res) => {
  // Get the bucket and filename from the Cloud Pub/Sub message
  let data;
  try {
    const message = Buffer.from(req.body.message.data, "base64").toString(
      "utf8",
    );
    data = JSON.parse(message);
    if (!data.name) {
      throw new Error("Invalid message payload received.");
    }
  } catch (error) {
    console.error(error);
    res.status(400).send("Bad Request: missing filename.");
    return;
  }

  const inputFileName = data.name; // Format of <UID>-<DATE>.<EXTENSION>
  const videoId = inputFileName.split(".")[0];

  if (!(await isVideoNew(videoId))) {
    res.status(400).send("Bad Request: video already processing or processed");
    return;
  }

  await setVideo(videoId, {
    id: videoId,
    uid: videoId.split("-")[0],
    status: "processing",
  });

  // Download the raw video from Cloud Storage
  await downloadRawVideo(inputFileName);

  // Transcode into multi-resolution HLS
  let hlsOutputDir: string;
  try {
    hlsOutputDir = await convertVideoToHls(inputFileName, videoId);
  } catch (err) {
    await Promise.all([
      deleteRawVideo(inputFileName),
      deleteHlsOutput(videoId),
    ]);
    console.error(err);
    res.status(500).send("Internal Server Error: video processing failed.");
    return;
  }

  // Upload HLS output (master playlist + all variants) to Cloud Storage
  await uploadHlsOutput(hlsOutputDir, videoId);

  await setVideo(videoId, {
    status: "processed",
    filename: `${videoId}/master.m3u8`,
  });

  // Cleanup local files
  await Promise.all([deleteRawVideo(inputFileName), deleteHlsOutput(videoId)]);

  res.status(200).send("Processing finished successfully");
});

app.listen(port, () => {
  console.log(`Video processing service listening at http://localhost:${port}`);
});
