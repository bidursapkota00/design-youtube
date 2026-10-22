# Design YouTube: Full Stack & System Design Guide

![Bidur Sapkota](https://www.bidursapkota.com.np/images/gravatar.webp "Bidur Sapkota - Developer")&nbsp;[Bidur Sapkota](https://www.bidursapkota.com.np/)

![Design YouTube: Full Stack & System Design Guide by Bidur Sapkota](youtube-1200.webp "Design YouTube: Full Stack & System Design Guide – Blog by Bidur Sapkota")

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Video Processing Service — Setup](#video-processing-service--setup)
3. [Video Processing Service — FFmpeg Integration](#video-processing-service--ffmpeg-integration)
4. [Dockerizing the Video Processing Service](#dockerizing-the-video-processing-service)
5. [Google Cloud Storage Integration](#google-cloud-storage-integration)
6. [Cloud Pub/Sub Message Handling](#cloud-pubsub-message-handling)
7. [Google Cloud Deployment](#google-cloud-deployment)
8. [Web Client — Next.js Setup](#web-client--nextjs-setup)
9. [Firebase Authentication](#firebase-authentication)
10. [Firebase Cloud Functions — API Service](#firebase-cloud-functions--api-service)
11. [Signed Upload URLs & CORS](#signed-upload-urls--cors)
12. [Upload Component](#upload-component)
13. [Firestore — Video Metadata](#firestore--video-metadata)
14. [Video Listing & Playback](#video-listing--playback)
15. [Deploying the Web Client](#deploying-the-web-client)
16. [Adaptive Streaming — HLS with M3U8](#adaptive-streaming--hls-with-m3u8)
17. [Content Delivery Network (CDN)](#content-delivery-network-cdn)
18. [Design Netflix — Subscription-Based Streaming with Khalti Payment Gateway](#design-netflix--subscription-based-streaming-with-khalti-payment-gateway)
19. [Design Udemy — Per-Course Purchase with Khalti Payment Gateway](#design-udemy--per-course-purchase-with-khalti-payment-gateway)

---

## Architecture Overview

This project builds a simplified YouTube clone using Google Cloud services. The system consists of three main components that work together:

- **Video Processing Service** — A Node.js/Express server that downloads raw videos from Cloud Storage, transcodes them to 360p using FFmpeg, and uploads the processed output. Runs as a Docker container on Cloud Run.
- **YouTube API Service** — Firebase Cloud Functions that handle user creation (Firestore), signed upload URL generation (Cloud Storage), and video listing.
- **YouTube Web Client** — A Next.js frontend that provides Google sign-in, video upload via signed URLs, a video listing homepage, and a watch page.

Cloud Pub/Sub connects Cloud Storage to the processing service: when a raw video is uploaded, a notification triggers the processing pipeline automatically.

---

## Video Processing Service — Setup

### Initialize the Project

```bash
mkdir video-processing-service
cd video-processing-service
npm init -y
```

### Install Dependencies

```bash
npm install express
npm install --save-dev typescript @types/express
```

`express` is the web framework. `typescript` is needed for type checking (`tsc --noEmit`) and production compilation (`tsc`). Node.js 24 runs `.ts` files natively by stripping types at startup, so `ts-node` is no longer needed. `@types/node` is bundled with modern Node.js versions. `@types/express` provides type definitions for Express.

### Create `.gitignore`

```text
node_modules
```

### Create `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`target` sets the JavaScript version to compile to. `module` and `moduleResolution` are set to `NodeNext` to use native ES modules, matching the `"type": "module"` in `package.json`. `strict` enables all strict type-checking options. `verbatimModuleSyntax` ensures all type imports use `import type` syntax — this is required for Node.js 24's type stripping, which erases types without transforming module syntax. `esModuleInterop` allows default imports from CommonJS modules like Express.

### Update `package.json` Scripts

```json
{
  "name": "video-processing-service",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "start": "node --watch src/index.ts",
    "build": "tsc",
    "serve": "node dist/index.js"
  },
  "author": "",
  "license": "ISC",
  "description": "",
  "devDependencies": {
    "@types/express": "^5.0.1",
    "typescript": "^5.8.3"
  },
  "dependencies": {
    "express": "^5.1.0"
  }
}
```

`"type": "module"` enables ES module syntax (`import`/`export`) natively. `start` uses `node --watch` to run TypeScript directly — Node.js 24 strips types at startup without any additional tooling, and `--watch` restarts the process on file changes (replacing `nodemon` + `ts-node`). `build` compiles TypeScript to JavaScript for production. `serve` runs the compiled output.

### Create `src/index.ts` — Basic Server

```typescript
import express from "express";

const app = express();
const port = 3000;

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Video processing service listening at http://localhost:${port}`);
});
```

Run with `npm start` and visit `http://localhost:3000` to confirm the server is working.

---

## Video Processing Service — FFmpeg Integration

### Install FFmpeg Dependencies

```bash
npm install fluent-ffmpeg
npm install --save-dev @types/fluent-ffmpeg
```

`fluent-ffmpeg` is a Node.js wrapper around the FFmpeg command-line tool for video/audio processing.

### Install FFmpeg System Binary

**Linux (Ubuntu/Debian):**

```bash
sudo apt-get update && sudo apt-get install -y ffmpeg
```

**macOS:**

```bash
brew install ffmpeg
```

### Update `src/index.ts` — Process Video Endpoint

```typescript
import express from "express";
import ffmpeg from "fluent-ffmpeg";

const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;

app.post("/process-video", (req, res) => {
  // Get path of the input video file from the request body
  const inputFilePath = req.body.inputFilePath;
  const outputFilePath = req.body.outputFilePath;

  if (!inputFilePath || !outputFilePath) {
    res.status(400).send("Bad Request: Missing file path.");
    return;
  }

  ffmpeg(inputFilePath)
    .outputOptions("-vf", "scale=-1:360") // 360p
    .on("end", () => {
      res.status(200).send("Processing finished successfully.");
    })
    .on("error", (err) => {
      console.log(`An error occurred: ${err.message}`);
      res.status(500).send(`Internal Server Error: ${err.message}`);
    })
    .save(outputFilePath);
});

app.listen(port, () => {
  console.log(`Video processing service listening at http://localhost:${port}`);
});
```

`app.use(express.json())` parses incoming JSON request bodies. The `/process-video` endpoint takes `inputFilePath` and `outputFilePath` from the request body, then uses FFmpeg to transcode the video to 360p resolution. `.outputOptions("-vf", "scale=-1:360")` applies a video filter that scales the height to 360 pixels while preserving aspect ratio (`-1` calculates the width automatically).

### Test with Thunder Client (or curl)

```text
POST http://localhost:3000/process-video

{
  "inputFilePath": "./nc-intro.mov",
  "outputFilePath": "./processed-nc-intro.mov"
}

Status: 200 OK
```

---

## Dockerizing the Video Processing Service

### Create `.dockerignore`

```text
node_modules
```

### Create `Dockerfile` — Multi-Stage Build

```dockerfile
# Stage 1: Build stage
FROM node:24 AS builder

# Set the working directory in the container to /app
WORKDIR /app

# Copy package.json and package-lock.json into the working directory
COPY package*.json ./

# Install any needed packages specified in package.json
RUN npm install

# Bundle app source inside the docker image
COPY . .

# Build the app
RUN npm run build

# Stage 2: Production stage
FROM node:24

# Install ffmpeg in the container
RUN apt-get update && apt-get install -y ffmpeg

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install only production dependencies
RUN npm install --only=production

# Copy built app from the builder stage
COPY --from=builder /app/dist ./dist

# Make port 3000 available to the world outside this container
EXPOSE 3000

# Define the command to run your app using CMD which defines your runtime
CMD [ "npm", "run", "serve" ]
```

Stage 1 (`builder`) installs all dependencies including dev dependencies, compiles TypeScript to JavaScript, and produces the `dist/` folder. Stage 2 starts fresh with `node:24`, installs FFmpeg and only production dependencies, then copies the compiled output from the builder stage. This keeps the final image small by excluding TypeScript, type definitions, and build tools. Although Node.js 24 can run `.ts` files directly, production still uses compiled output for faster startup and to catch type errors at build time.

### Create `Dockerfile.dev` — Single-Stage Development Build

The multi-stage Dockerfile above is optimized for production. During development, you want hot reload so that code changes reflect immediately without rebuilding the image. Node.js 24 has built-in `--watch` mode and native TypeScript support, so no extra dependencies like `nodemon` or `ts-node` are needed:

```dockerfile
FROM node:24

# Install ffmpeg
RUN apt-get update && apt-get install -y ffmpeg

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Source code is mounted via volume — no COPY needed
# COPY . .  ← intentionally omitted

EXPOSE 3000

# Node 24 runs .ts natively and --watch restarts on file changes
CMD [ "node", "--watch", "src/index.ts" ]
```

Build and run with a volume mount so your local `src/` is live-synced into the container:

```bash
# Build the dev image
docker build -f Dockerfile.dev -t video-processing-service-dev .

# Run with volume mount — edits to src/ on your host reflect instantly
docker run -p 3000:3000 -v $(pwd)/src:/app/src -d video-processing-service-dev
```

`-f Dockerfile.dev` tells Docker to use the development Dockerfile instead of the default. `-v $(pwd)/src:/app/src` mounts your local `src/` directory into the container. Node.js 24's `--watch` flag monitors the file tree and restarts the process on changes — combined with native type stripping, this replaces both `nodemon` and `ts-node` with zero extra dependencies.

### Build & Run

```bash
docker build -t video-processing-service .
docker images
```

```bash
docker run -p 3000:3000 -d video-processing-service
docker ps
```

### Test Inside the Container

Copy a test video into the running container, process it, and copy the result back:

```bash
docker cp ./nc-intro.mov <container_name>:/app/nc-intro.mov
```

Send the processing request:

```text
POST http://localhost:3000/process-video

{
  "inputFilePath": "./nc-intro.mov",
  "outputFilePath": "./processed-nc-intro.mov"
}

Status: 200 OK
Processing finished successfully.
```

Copy the processed video back to the host:

```bash
docker cp <container_name>:/app/processed-nc-intro.mov ./
```

### Cleanup

```bash
docker ps                                 # Find running containers
docker stop <container_id>                # Stop the container
docker rm <container_id>                  # Remove the container
docker images                             # List images
docker rmi <image_id>                     # Remove the image
```

---

## Google Cloud Storage Integration

### Install Cloud Storage SDK

```bash
npm install @google-cloud/storage
```

### Create `src/storage.ts`

```typescript
import { Storage } from "@google-cloud/storage";
import fs from "fs";
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

/**
 * @param rawVideoName - The name of the file to convert from {@link localRawVideoPath}.
 * @param processedVideoName - The name of the file to convert to {@link localProcessedVideoPath}.
 * @returns A promise that resolves when the video has been converted.
 */
export function convertVideo(rawVideoName: string, processedVideoName: string) {
  return new Promise<void>((resolve, reject) => {
    ffmpeg(`${localRawVideoPath}/${rawVideoName}`)
      .outputOptions("-vf", "scale=-1:360") // 360p
      .on("end", () => {
        console.log("Processing finished successfully.");
        resolve();
      })
      .on("error", (err) => {
        console.log(`An error occurred: ${err.message}`);
        reject(err);
      })
      .save(`${localProcessedVideoPath}/${processedVideoName}`);
  });
}

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
 * @param fileName - The name of the file to upload from the
 * {@link localProcessedVideoPath} folder into the {@link processedVideoBucketName}.
 * @returns A promise that resolves when the file has been uploaded.
 */
export async function uploadProcessedVideo(fileName: string) {
  const bucket = storage.bucket(processedVideoBucketName);

  await bucket.upload(`${localProcessedVideoPath}/${fileName}`, {
    destination: fileName,
  });
  console.log(
    `${localProcessedVideoPath}/${fileName} uploaded to gs://${processedVideoBucketName}/${fileName}`,
  );

  await bucket.file(fileName).makePublic();
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
 * @param fileName - The name of the file to delete from the
 * {@link localProcessedVideoPath} folder.
 * @returns A promise that resolves when the file has been deleted.
 */
export function deleteProcessedVideo(fileName: string) {
  return deleteFile(`${localProcessedVideoPath}/${fileName}`);
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
    fs.mkdirSync(dirPath, { recursive: true }); // recursive: true enables creating nested directories
    console.log(`Directory created at ${dirPath}`);
  }
}
```

`Storage` from `@google-cloud/storage` authenticates automatically using Application Default Credentials when running on Google Cloud. `setupDirectories()` creates local folders to temporarily store raw and processed videos. `convertVideo()` wraps FFmpeg in a Promise for async/await usage. `downloadRawVideo()` pulls from Cloud Storage to the local filesystem. `uploadProcessedVideo()` pushes the processed file back and makes it publicly accessible. `deleteFile()` is a utility that safely removes a local file, resolving even if the file does not exist.

---

## Cloud Pub/Sub Message Handling

### Update `src/index.ts` — Full Processing Pipeline

When a video is uploaded to the raw videos bucket, Cloud Pub/Sub sends a notification to the `/process-video` endpoint. The message body contains a base64-encoded JSON payload with the filename.

Reference: [Cloud Run Pub/Sub Tutorial](https://cloud.google.com/run/docs/tutorials/pubsub#run_pubsub_server-nodejs)

```typescript
import express from "express";
import {
  setupDirectories,
  downloadRawVideo,
  convertVideo,
  deleteRawVideo,
  deleteProcessedVideo,
  uploadProcessedVideo,
} from "./storage";

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

  const inputFileName = data.name;
  const outputFileName = `processed-${inputFileName}`;

  // Download the raw video from Cloud Storage
  await downloadRawVideo(inputFileName);

  // Convert the video to 360p
  try {
    await convertVideo(inputFileName, outputFileName);
  } catch (err) {
    await Promise.all([
      deleteRawVideo(inputFileName),
      deleteProcessedVideo(outputFileName),
    ]);
    console.error(err);
    res.status(500).send("Internal Server Error: video processing failed.");
    return;
  }

  // Upload the processed video to Cloud Storage
  await uploadProcessedVideo(outputFileName);

  await Promise.all([
    deleteRawVideo(inputFileName),
    deleteProcessedVideo(outputFileName),
  ]);
  res.status(200).send("Processing finished successfully");
});

app.listen(port, () => {
  console.log(`Video processing service listening at http://localhost:${port}`);
});
```

The Pub/Sub message arrives as `req.body.message.data` in base64 encoding. After decoding, `data.name` contains the filename of the uploaded object. The pipeline downloads the raw video, converts it, uploads the result, and cleans up local files. `Promise.all` runs deletions concurrently for efficiency. On error during conversion, both local files are deleted before returning a 500 response.

---

## Google Cloud Deployment

### Create a Google Cloud Project

Create a new project in the Google Cloud Console and note the project ID (e.g., `yt-clone-3dce6`).

### Install & Configure gcloud CLI

```bash
gcloud -v                                # Verify installation
gcloud components update                 # Update all components to latest
gcloud auth login                        # Authenticate
gcloud config set project <PROJECT_ID>   # Set active project
gcloud config get-value project          # Verify project
```

`gcloud components update` ensures all installed gcloud CLI components (including `gsutil`, `bq`, and `kubectl` if present) are at the latest version. Run this before any deployment to avoid compatibility issues with newer GCP APIs.

### Enable Artifact Registry

```bash
gcloud services enable artifactregistry.googleapis.com
```

Or search for "Artifact Registry API" in the Google Cloud Console and enable it from the UI.

### Create a Docker Repository

```bash
gcloud artifacts repositories create video-processing-repo \
  --repository-format=docker \
  --location=us-central1 \
  --description="Docker repo for video processing service"
```

Or create through the UI: Artifact Registry → Repositories → Create Repository → Docker format → Google-managed encryption key.

### Build, Tag & Push the Docker Image

```bash
# Build the image tagged for Artifact Registry
docker build -t us-central1-docker.pkg.dev/<PROJECT_ID>/video-processing-repo/video-processing-service .

# Authenticate Docker with Artifact Registry
gcloud auth configure-docker us-central1-docker.pkg.dev

# Push the image
docker push us-central1-docker.pkg.dev/<PROJECT_ID>/video-processing-repo/video-processing-service
```

Verify in the UI: Artifact Registry → Repositories → `video-processing-repo` → `video-processing-service`.

### Deploy to Cloud Run

```bash
gcloud services enable run.googleapis.com
```

From the Cloud Console:

1. Search **Cloud Run** → **Create Service**
2. Service name: `video-processing-service`
3. Deploy from an existing container image → Select the pushed image
4. Ingress control: **Internal**
5. Authentication: **Allow unauthenticated invocations**

After deployment, you get a service URL (e.g., `https://video-processing-service-v6j6pvk7fq-uc.a.run.app`).

### Set Up Cloud Pub/Sub

```text
From UI: Pub/Sub → Create Topic → "video-uploads-topic"

From UI: Create Subscription → "video-uploads-subscription"
  Delivery type: Push
  Endpoint URL: https://video-processing-service-v6j6pvk7fq-uc.a.run.app/process-video
```

### Create Cloud Storage Buckets

```bash
# Raw videos bucket with uniform bucket-level access
gsutil mb -l us-central1 --pap=enforced gs://codeyalaya-yt-raw-videos

# Link the bucket to Pub/Sub (trigger on file upload)
gsutil notification create -t video-uploads-topic -f json \
  -e OBJECT_FINALIZE gs://codeyalaya-yt-raw-videos

# Processed videos bucket
gsutil mb -l us-central1 gs://codeyalaya-yt-processed-videos
```

`-l` sets the location. `--pap=enforced` enforces uniform bucket-level access (no per-object ACLs). `-e OBJECT_FINALIZE` triggers the notification only when an object upload is completed. `-f json` sends the notification payload as JSON.

### Test the Pipeline

1. Upload a video file to the `codeyalaya-yt-raw-videos` bucket (Cloud Console → Buckets → Upload Files)
2. Check Cloud Run logs to see the processing
3. Verify the processed video appears in `codeyalaya-yt-processed-videos`

---

## Web Client — Next.js Setup

### Initialize Next.js Project

```bash
mkdir youtube-webclient
cd youtube-webclient
npx -y create-next-app@latest ./
```

### Create `src/ui/navbar/navbar.tsx`

```tsx
import Image from "next/image";
import Link from "next/link";
import styles from "./navbar.module.css";

export default function Navbar() {
  return (
    <nav className={styles.nav}>
      <Link href="/">
        <Image
          width={90}
          height={20}
          src="/youtube-logo.svg"
          alt="YouTube Logo"
        />
      </Link>
    </nav>
  );
}
```

### Create `src/ui/navbar/navbar.module.css`

```css
.nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1em;
}
```

### Update `src/app/layout.tsx`

Import and render the `Navbar` in the root layout so it appears on every page:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "../ui/navbar/navbar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Create Next App",
  description: "Generated by create next app",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Navbar />
        {children}
      </body>
    </html>
  );
}
```

---

## Firebase Authentication

### Install Firebase SDK

```bash
npm install firebase
```

### Create `src/app/firebase/firebase.ts`

```typescript
import { initializeApp } from "firebase/app";

const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
```

Get the config values from the Firebase Console: Project Settings → General → Your apps → Web app. These values are safe to expose in client-side code; Firebase Security Rules protect your data.

### Create `src/app/firebase/auth.ts`

```typescript
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import { getFunctions } from "firebase/functions";
import { app } from "./firebase";

const auth = getAuth(app);
export const functions = getFunctions();

/**
 * Signs the user in with a Google popup.
 * @returns A promise that resolves with the user's credentials.
 */
export function signInWithGoogle() {
  return signInWithPopup(auth, new GoogleAuthProvider());
}

/**
 * Signs the user out.
 * @returns A promise that resolves when the user is signed out.
 */
export function signOut() {
  return auth.signOut();
}

/**
 * Trigger a callback when user auth state changes.
 * @returns A function to unsubscribe callback.
 */
export function onAuthStateChangedHelper(
  callback: (user: User | null) => void,
) {
  return onAuthStateChanged(auth, callback);
}
```

`signInWithPopup` opens a Google sign-in dialog. `onAuthStateChanged` fires whenever the user signs in or out, and returns an `unsubscribe` function to stop listening.

### Enable Google Sign-In in Firebase Console

1. Firebase Console → Authentication → Sign-in method
2. Enable **Google** provider
3. Set the project support email

### Create `src/ui/navbar/sign-in.tsx`

```tsx
import { Fragment } from "react";
import { signInWithGoogle, signOut } from "@/app/firebase/auth";
import styles from "./sign-in.module.css";
import { User } from "firebase/auth";

interface SignInProps {
  user: User | null;
}

export default function SignIn({ user }: SignInProps) {
  return (
    <Fragment>
      {user ? (
        <button className={styles.signin} onClick={signOut}>
          Sign Out
        </button>
      ) : (
        <button className={styles.signin} onClick={signInWithGoogle}>
          Sign In
        </button>
      )}
    </Fragment>
  );
}
```

The component conditionally renders Sign Out or Sign In based on whether a `user` object is passed. `signOut` and `signInWithGoogle` are called directly as click handlers.

### Create `src/ui/navbar/sign-in.module.css`

```css
.signin {
  display: inline-block;
  border: 1px solid gray;
  color: #065fd4;
  padding: 10px 20px;
  border-radius: 24px;
  font-family: "Roboto", "Arial", sans-serif;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.signin:hover {
  background-color: #bee0fd;
  border: 1px solid transparent;
}
```

### Update `src/ui/navbar/navbar.tsx` — Add Auth State

```tsx
"use client";

import SignIn from "./sign-in";
import { onAuthStateChangedHelper } from "@/app/firebase/auth";
import { useEffect, useState } from "react";
import { User } from "firebase/auth";
import Image from "next/image";
import Link from "next/link";
import styles from "./navbar.module.css";
import Upload from "./upload";

export default function Navbar() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChangedHelper((user) => {
      setUser(user);
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  });

  return (
    <nav className={styles.nav}>
      <Link href="/">
        <Image
          width={90}
          height={20}
          src="/youtube-logo.png"
          alt="YouTube Logo"
        />
      </Link>
      {user && <Upload />}
      <SignIn user={user} />
    </nav>
  );
}
```

`"use client"` is required because this component uses React hooks (`useState`, `useEffect`). The `onAuthStateChangedHelper` listener updates the `user` state whenever auth state changes. The Upload button only renders when a user is logged in (`user && <Upload />`). The `unsubscribe` function is returned in the `useEffect` cleanup to prevent memory leaks.

---

## Firebase Cloud Functions — API Service

### Set Up Firebase Functions

```bash
npm install -g firebase-tools
firebase login
```

```bash
mkdir youtube-api-functions
cd youtube-api-functions
firebase init functions
```

Select TypeScript when prompted. Then install dependencies:

```bash
cd functions
npm install firebase-functions@latest firebase-admin@latest
```

### Create Firestore Database

In the Firebase Console: Firestore Database → **Create database**.

### Test the Emulator

```bash
npm run serve
```

Visit `http://127.0.0.1:5001/<PROJECT_ID>/us-central1/helloWorld` to confirm the function is running. The Firebase Emulator Suite UI is available at `http://localhost:4000`.

### Create `functions/src/index.ts` — createUser Function

```typescript
import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as functions from "firebase-functions/v1";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { Storage } from "@google-cloud/storage";

initializeApp();

const firestore = getFirestore("codeyalaya");
const storage = new Storage();

const rawVideoBucketName = "codeyalaya-yt-raw-videos";

const videoCollectionId = "videos";

export interface Video {
  id?: string;
  uid?: string;
  filename?: string;
  status?: "processing" | "processed";
  title?: string;
  description?: string;
}

export const createUser = functions.auth.user().onCreate(async (user) => {
  if (!user || !user.uid) {
    logger.error("Invalid user data received");
    return;
  }

  const userInfo = {
    uid: user.uid,
    email: user.email || null,
    photoUrl: user.photoURL || null,
    createdAt: new Date().toISOString(),
  };

  try {
    await firestore.collection("users").doc(user.uid).set(userInfo);
    logger.info(`User Created: ${JSON.stringify(userInfo)}`);
    return { success: true };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    logger.error("Error writing to Firestore:", { message: errorMessage });
    return { success: false, error: errorMessage };
  }
});
```

`functions.auth.user().onCreate` triggers automatically when a new user signs up via Firebase Authentication. It writes the user's `uid`, `email`, and `photoURL` to a Firestore `users` collection. `initializeApp()` initializes the Firebase Admin SDK with default credentials (automatic on Google Cloud).

### Deploy

```bash
npm run deploy
```

Verify in Firebase Console: Functions → Dashboard → `createUser` (1st gen).

---

## Signed Upload URLs & CORS

### Install Cloud Storage SDK in Functions

```bash
cd functions
npm install @google-cloud/storage
```

### Add `generateUploadUrl` to `functions/src/index.ts`

```typescript
export const generateUploadUrl = onCall(
  { maxInstances: 1 },
  async (request) => {
    // Check if the user is authenticated
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "The function must be called while authenticated.",
      );
    }

    const auth = request.auth;
    const data = request.data;
    const bucket = storage.bucket(rawVideoBucketName);

    // Generate a unique filename
    const fileName = `${auth.uid}-${Date.now()}.${data.fileExtension}`;

    // Get a v4 signed URL for uploading file
    const [url] = await bucket.file(fileName).getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
    });

    return { url, fileName };
  },
);
```

`onCall` creates a callable function that can be invoked from the client SDK. `request.auth` is automatically populated by Firebase when the user is signed in. The filename format `<UID>-<TIMESTAMP>.<EXTENSION>` ensures uniqueness and ties uploads to users. `getSignedUrl` generates a temporary pre-signed URL that allows the client to upload directly to Cloud Storage without routing the file through the server.

### Deploy the Function

```bash
firebase deploy --only functions:generateUploadUrl
```

Verify in Google Cloud Console: Cloud Functions → `generateUploadUrl` (2nd gen). Note the service account (e.g., `437029731285-compute@developer.gserviceaccount.com`).

### Grant Permissions

The Cloud Function's service account needs permission to create signed URLs:

1. **Cloud Storage bucket permissions**: Go to Cloud Storage → `codeyalaya-yt-raw-videos` → Permissions → Grant Access → Add the service account principal (437029731285-compute@developer.gserviceaccount.com) → Role: **Cloud Storage → Storage Object Admin**

2. **Service Account Token Creator role**: Go to IAM & Admin → Find the compute service account → Edit → Add role: **Service Account Token Creator**

3. **Verify from CLI**

```bash
gcloud describe functions generateUploadUrl --region=us-central1
...
Service Account: 437029731285-compute@developer.gserviceaccount.com
```

### Configure CORS on the Raw Videos Bucket

Create `utils/gcs-cors.json`:

```json
[
  {
    "origin": ["*"],
    "responseHeader": ["Content-Type"],
    "method": ["PUT"],
    "maxAgeSeconds": 3600
  }
]
```

Apply the CORS configuration:

```bash
gcloud storage buckets update gs://codeyalaya-yt-raw-videos \
  --cors-file=utils/gcs-cors.json
```

CORS headers are required because the browser uploads directly to Cloud Storage from a different origin. Without this, the browser blocks the PUT request. `"origin": ["*"]` allows any domain (restrict to your domain in production).

### Enable IAM Service Account Credentials API

In the Google Cloud Console, search for **IAM Service Account Credentials API** and enable it, or:

```bash
gcloud services enable iamcredentials.googleapis.com
```

---

## Upload Component

### Create `src/app/firebase/functions.ts`

```typescript
import { httpsCallable } from "firebase/functions";
import { functions } from "./auth";

const generateUploadUrl = httpsCallable<
  { fileExtension: string },
  UploadUrlResponse
>(functions, "generateUploadUrl");
const getVideosFunction = httpsCallable(functions, "getVideos");

export interface Video {
  id?: string;
  uid?: string;
  filename?: string;
  status?: "processing" | "processed";
  title?: string;
  description?: string;
}

interface UploadUrlResponse {
  url: string;
  fileName: string;
}

export async function uploadVideo(file: File) {
  const response = await generateUploadUrl({
    fileExtension: file.name.split(".").pop()!,
  });

  // Upload the file via the signed URL
  await fetch(response?.data?.url, {
    method: "PUT",
    body: file,
    headers: {
      "Content-Type": file.type,
    },
  });

  return;
}

export async function getVideos() {
  const response = await getVideosFunction();
  return response.data as Video[];
}
```

`httpsCallable` creates a client-side callable reference to the Cloud Function. `generateUploadUrl` is typed with generics: the request sends `{ fileExtension }` and receives `{ url, fileName }`. `uploadVideo` first requests a signed URL from the Cloud Function, then uses `fetch` with `PUT` to upload the file directly to Cloud Storage. The file never passes through your server.

### Create `src/ui/navbar/upload.tsx`

```tsx
"use client";

import { Fragment } from "react";
import { uploadVideo } from "@/app/firebase/functions";
import styles from "./upload.module.css";

export default function Upload() {
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.item(0);
    if (file) {
      handleUpload(file);
    }
  };

  const handleUpload = async (file: File) => {
    try {
      const response = await uploadVideo(file);
      alert(
        `File uploaded successfully. Response: ${JSON.stringify(response)}`,
      );
    } catch (error) {
      alert(`Failed to upload file: ${error}`);
    }
  };

  return (
    <Fragment>
      <input
        id="upload"
        className={styles.uploadInput}
        type="file"
        accept="video/*"
        onChange={handleFileChange}
      />
      <label htmlFor="upload" className={styles.uploadButton}>
        Upload
      </label>
    </Fragment>
  );
}
```

The hidden `<input>` element is triggered by clicking the styled `<label>`. `accept="video/*"` restricts the file picker to video files. `onChange` fires when a file is selected, which calls `handleUpload` to invoke the upload flow.

### Create `src/ui/navbar/upload.module.css`

```css
.uploadInput {
  display: none; /* Hide the default input */
}

.uploadButton {
  display: flex; /* Use Flexbox to center the text */
  justify-content: center; /* Center text horizontally */
  align-items: center; /* Center text vertically */
  width: 25px;
  height: 25px;
  border-radius: 50%; /* Make it circular */
  color: black; /* Color of the text */
  border: none;
  cursor: pointer;
  font-size: 10px;
  padding: 0.4em;
}

.uploadButton:hover {
  background-color: rgb(230, 230, 230);
}
```

---

## Firestore — Video Metadata

### Install Firebase Admin in the Video Processing Service

```bash
cd video-processing-service
npm install firebase-admin
```

### Create `src/firestore.ts` in the Video Processing Service

```typescript
import { credential } from "firebase-admin";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp({ credential: credential.applicationDefault() });

const firestore = getFirestore("codeyalaya");

// Note: This requires setting an env variable in Cloud Run
/** if (process.env.NODE_ENV !== 'production') {
    firestore.settings({
        host: "localhost:8080", // Default port for Firestore emulator
        ssl: false
    });
} */

const videoCollectionId = "videos";

export interface Video {
  id?: string;
  uid?: string;
  filename?: string;
  status?: "processing" | "processed";
  title?: string;
  description?: string;
}

async function getVideo(videoId: string) {
  const snapshot = await firestore
    .collection(videoCollectionId)
    .doc(videoId)
    .get();
  return (snapshot.data() as Video) ?? {};
}

export function setVideo(videoId: string, video: Video) {
  return firestore
    .collection(videoCollectionId)
    .doc(videoId)
    .set(video, { merge: true });
}

export async function isVideoNew(videoId: string) {
  const video = await getVideo(videoId);
  return video?.status === undefined;
}
```

`credential.applicationDefault()` authenticates using the default service account when running on Google Cloud. `getFirestore("codeyalaya")` connects to the named Firestore database. `setVideo` uses `{ merge: true }` so it updates only the specified fields without overwriting existing data. `isVideoNew` checks if the video has been processed before to prevent duplicate processing.

### Update `src/index.ts` — Add Firestore Integration

```typescript
import express from "express";
import {
  setupDirectories,
  downloadRawVideo,
  convertVideo,
  deleteRawVideo,
  deleteProcessedVideo,
  uploadProcessedVideo,
} from "./storage";
import { isVideoNew, setVideo } from "./firestore";

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
  const outputFileName = `processed-${inputFileName}`;
  const videoId = inputFileName.split(".")[0];

  if (!(await isVideoNew(videoId))) {
    res.status(400).send("Bad Request: video already processing or processed");
    return;
  } else {
    await setVideo(videoId, {
      id: videoId,
      uid: videoId.split("-")[0],
      status: "processing",
    });
  }

  // Download the raw video from Cloud Storage
  await downloadRawVideo(inputFileName);

  // Convert the video to 360p
  try {
    await convertVideo(inputFileName, outputFileName);
  } catch (err) {
    await Promise.all([
      deleteRawVideo(inputFileName),
      deleteProcessedVideo(outputFileName),
    ]);
    console.error(err);
    res.status(500).send("Internal Server Error: video processing failed.");
    return;
  }

  // Upload the processed video to Cloud Storage
  await uploadProcessedVideo(outputFileName);

  await setVideo(videoId, {
    status: "processed",
    filename: outputFileName,
  });

  await Promise.all([
    deleteRawVideo(inputFileName),
    deleteProcessedVideo(outputFileName),
  ]);
  res.status(200).send("Processing finished successfully");
});

app.listen(port, () => {
  console.log(`Video processing service listening at http://localhost:${port}`);
});
```

`videoId` is extracted by splitting the filename at the dot (removing the extension). `isVideoNew` prevents reprocessing if a video has already been handled. The status is set to `"processing"` at the start and `"processed"` after successful upload, enabling the frontend to show processing state.

### Rebuild & Redeploy the Video Processing Service

```bash
docker build -t us-central1-docker.pkg.dev/<PROJECT_ID>/video-processing-repo/video-processing-service .

docker push us-central1-docker.pkg.dev/<PROJECT_ID>/video-processing-repo/video-processing-service
```

Deploy to Cloud Run (from UI or CLI):

```bash
gcloud run deploy video-processing-service \
  --image us-central1-docker.pkg.dev/<PROJECT_ID>/video-processing-repo/video-processing-service \
  --region=us-central1 \
  --platform managed \
  --timeout=3600 \
  --memory=2Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=1 \
  --ingress=internal
```

`--timeout=3600` allows up to 1 hour for video processing. `--memory=2Gi` allocates enough memory for FFmpeg. `--ingress=internal` restricts access to internal traffic (Pub/Sub) only. `--max-instances=1` limits to a single instance to control costs.

---

## Video Listing & Playback

### Add `getVideos` to Cloud Functions

Add this to `functions/src/index.ts`:

```typescript
export const getVideos = onCall({ maxInstances: 1 }, async () => {
  const snapshot = await firestore
    .collection(videoCollectionId)
    .limit(10)
    .get();
  return snapshot.docs.map((doc) => doc.data());
});
```

Deploy:

```bash
firebase deploy --only functions:getVideos
```

Verify by sending a POST request:

```text
POST https://getvideos-v6j6pvk7fq-uc.a.run.app

{
  "data": {}
}

Status: 200 OK
{
  "result": [
    {
      "uid": "82556WyT0mV4xkMtHOvaA97WwrV2",
      "id": "82556WyT0mV4xkMtHOvaA97WwrV2-1689378642819",
      "filename": "processed-82556WyT0mV4xkMtHOvaA97WwrV2-1689378642819.mp4",
      "status": "processed"
    }
  ]
}
```

### Update `src/app/page.tsx` — Video Listing

```tsx
import styles from "./page.module.css";
import Link from "next/link";
import Image from "next/image";
import { getVideos } from "@/app/firebase/functions";

export default async function Home() {
  const videos = await getVideos();

  return (
    <main>
      {videos.map((video) => (
        <Link href={`/watch?v=${video.filename}`} key={video.id}>
          <Image
            src={"/thumbnail.jpg"}
            alt="video"
            width={120}
            height={80}
            className={styles.thumbnail}
          />
        </Link>
      ))}
    </main>
  );
}

export const revalidate = 30;
```

`export const revalidate = 30` tells Next.js to re-fetch the video list every 30 seconds using Incremental Static Regeneration (ISR). Each video links to the watch page with the filename as a query parameter.

### Create `src/app/page.module.css`

```css
.thumbnail {
  margin: 10px;
}
```

### Create `src/app/watch/page.tsx`

```tsx
"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

// Component that uses useSearchParams
function VideoPlayer() {
  const videoPrefix =
    "https://storage.googleapis.com/codeyalaya-yt-processed-videos/";
  const searchParams = useSearchParams();
  const videoSrc = searchParams.get("v");

  return (
    <>
      <h1>Watch Page</h1>
      {videoSrc ? (
        <video controls src={videoPrefix + videoSrc} />
      ) : (
        <p>No video selected</p>
      )}
    </>
  );
}

// Loading component for Suspense fallback
function Loading() {
  return <p>Loading video player...</p>;
}

// Main page component with Suspense boundary
export default function Watch() {
  return (
    <div>
      <Suspense fallback={<Loading />}>
        <VideoPlayer />
      </Suspense>
    </div>
  );
}
```

`"use client"` is required because `useSearchParams` is a client-side hook. `Suspense` wraps `VideoPlayer` because `useSearchParams` needs a Suspense boundary in Next.js App Router. The `videoPrefix` points to the public Cloud Storage URL for processed videos. The `<video>` element uses the native HTML5 video player with controls.

---

## Deploying the Web Client

### Create `.dockerignore`

```text
node_modules
```

### Create `Dockerfile`

```dockerfile
# Stage 1: Build stage
FROM node:18 AS builder

# Set the working directory
WORKDIR /app

# Copy package*.json files
COPY package*.json ./

# Install all dependencies
RUN npm install

# Copy other source code files
COPY . .

# Build the app
RUN npm run build

# Stage 2: Production stage
FROM node:18

# Set the working directory
WORKDIR /app

# Copy package*.json files
COPY package*.json ./

# Install only production dependencies
RUN npm install --only=production

# Copy built app from the builder stage
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

# Expose the listening port
EXPOSE 3000

# Run the app
CMD ["npm", "start"]
```

The build stage compiles the Next.js app (producing `.next/`). The production stage copies only the built output and public assets, keeping the image small.

### Create Artifact Registry Repository

```bash
gcloud artifacts repositories create yt-web-client-repo \
  --repository-format=docker \
  --location=us-central1 \
  --description="Docker repo for YouTube web client"
```

Or from the UI: Artifact Registry → Create Repository → `yt-web-client-repo` → Docker → Standard → Region → Google-managed encryption key.

### Build, Push & Deploy

```bash
# Build the image
docker build -t us-central1-docker.pkg.dev/<PROJECT_ID>/yt-web-client-repo/yt-web-client .

# Push to Artifact Registry
docker push us-central1-docker.pkg.dev/<PROJECT_ID>/yt-web-client-repo/yt-web-client

# Deploy to Cloud Run
gcloud run deploy yt-web-client \
  --image us-central1-docker.pkg.dev/<PROJECT_ID>/yt-web-client-repo/yt-web-client \
  --region=us-central1 \
  --platform managed \
  --timeout=3600 \
  --memory=2Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=1
```

When prompted: `Allow unauthenticated invocations to [yt-web-client] (y/N)?` → **y**

After deployment, you get a service URL (e.g., `https://yt-web-client-v6j6pvk7fq-uc.a.run.app`).

### Add Cloud Run URL to Firebase Authorized Domains

1. Firebase Console → Authentication → Settings → Authorized domains
2. Add the Cloud Run service URL (e.g., `yt-web-client-v6j6pvk7fq-uc.a.run.app`)

This allows Firebase Authentication to work from the deployed domain. Without this, Google sign-in will fail with an unauthorized domain error.

---

## Adaptive Streaming — HLS with M3U8

The previous sections serve a single 360p MP4 file per video. Real streaming platforms use **HTTP Live Streaming (HLS)** to deliver multiple quality levels and let the player switch automatically based on network conditions. This section replaces the single-file approach with a full adaptive bitrate pipeline: the processing service transcodes each upload into 360p, 480p, and 720p HLS streams, generates a master M3U8 playlist, uploads everything to Cloud Storage, and the web client uses HLS.js to play it with quality switching.

### How HLS Works

HLS splits a video into small `.ts` (Transport Stream) segments — typically 6–10 seconds each. A **variant playlist** (`.m3u8`) for each quality level lists its segments. A **master playlist** references all variant playlists and declares their resolution/bandwidth so the player can choose the right one.

```text
master.m3u8
├── 360p/playlist.m3u8  → 360p/segment000.ts, 360p/segment001.ts, ...
├── 480p/playlist.m3u8  → 480p/segment000.ts, 480p/segment001.ts, ...
└── 720p/playlist.m3u8  → 720p/segment000.ts, 720p/segment001.ts, ...
```

The player starts with the quality that matches current bandwidth. If the network degrades mid-stream, it drops to a lower variant without rebuffering. If bandwidth improves, it steps up seamlessly.

### Update `src/storage.ts` — Multi-Resolution HLS Transcoding

Replace the `convertVideo` function (or add alongside it) and add helpers for HLS output:

```typescript
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
        // Compute the destination path relative to localProcessedVideoPath
        const destination = path.relative(localProcessedVideoPath, fullPath);

        // Determine Content-Type
        let contentType = "application/octet-stream";
        if (entry.name.endsWith(".m3u8")) {
          contentType = "application/vnd.apple.mpegurl";
        } else if (entry.name.endsWith(".ts")) {
          contentType = "video/mp2t";
        }

        await bucket.upload(fullPath, {
          destination,
          metadata: { contentType },
        });
      }
    }
  }

  await uploadRecursive(localDir);

  // Make all uploaded files public
  const [files] = await bucket.getFiles({ prefix: `${videoId}/` });
  await Promise.all(files.map((file) => file.makePublic()));

  console.log(`HLS output for ${videoId} uploaded and made public.`);
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
```

**Key changes from the single-file version:**

- `HLS_VARIANTS` defines the three quality levels with their encoding parameters. `videoBitrate` controls file size, `maxrate`/`bufsize` enforce CBR-like behavior for smoother streaming, and `bandwidth` is written into the master playlist so the player knows how much throughput each variant needs.
- `transcodeVariant` uses FFmpeg's built-in HLS muxer (`-f hls`). `-hls_time 6` creates 6-second segments. `-hls_playlist_type vod` writes the `#EXT-X-ENDLIST` tag so the player knows the stream is complete. `-scale=-2:height` keeps the width even (required by libx264) while preserving aspect ratio.
- `generateMasterPlaylist` writes the `#EXT-X-STREAM-INF` entries that tell the player what variants are available. Resolutions are calculated assuming 16:9, but the actual scaling in FFmpeg handles any aspect ratio.
- `uploadHlsOutput` walks the directory recursively and sets the correct `Content-Type` — `application/vnd.apple.mpegurl` for `.m3u8` files and `video/mp2t` for `.ts` segments. Without correct MIME types, some browsers and players will refuse to load the streams.

### Update `src/index.ts` — HLS Processing Pipeline

Replace the processing endpoint to use the HLS pipeline:

```typescript
import express from "express";
import {
  setupDirectories,
  downloadRawVideo,
  convertVideoToHls,
  uploadHlsOutput,
  deleteRawVideo,
  deleteHlsOutput,
} from "./storage";
import { isVideoNew, setVideo } from "./firestore";

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
```

The key difference from the single-file pipeline: instead of producing one `processed-<filename>.mp4`, the service now produces a directory tree (`<videoId>/master.m3u8`, `<videoId>/360p/...`, etc.) and stores `<videoId>/master.m3u8` as the `filename` in Firestore. The watch page uses this path to initialize the HLS player.

### Update Firestore `Video` Interface

No schema changes are needed. The `filename` field now stores `<videoId>/master.m3u8` instead of `processed-<filename>.mp4`. The `status` field works exactly the same way.

### Update Cloud Storage CORS for HLS

HLS requires the browser to fetch `.m3u8` playlists and `.ts` segments via `GET` requests. Update the CORS config for the **processed videos** bucket:

Create `utils/gcs-cors-hls.json`:

```json
[
  {
    "origin": ["*"],
    "responseHeader": ["Content-Type", "Content-Length", "Range"],
    "method": ["GET", "HEAD"],
    "maxAgeSeconds": 3600
  }
]
```

Apply it:

```bash
gcloud storage buckets update gs://codeyalaya-yt-processed-videos \
  --cors-file=utils/gcs-cors-hls.json
```

The `Range` header is exposed because HLS.js uses range requests for efficient segment fetching. Without CORS on the processed bucket, the browser blocks the player from loading segments cross-origin.

### Update the Dockerfile — Increase Resources

Transcoding three variants is more CPU- and memory-intensive. Update the Cloud Run deployment:

```bash
gcloud run deploy video-processing-service \
  --image us-central1-docker.pkg.dev/<PROJECT_ID>/video-processing-repo/video-processing-service \
  --region=us-central1 \
  --platform managed \
  --timeout=3600 \
  --memory=4Gi \
  --cpu=2 \
  --min-instances=0 \
  --max-instances=1 \
  --ingress=internal
```

`--memory=4Gi` and `--cpu=2` give FFmpeg more headroom for parallel encoding. The Dockerfile itself does not change — only the Cloud Run resource allocation.

### Web Client — Install HLS.js

HLS.js is a JavaScript library that implements the HLS protocol in the browser. Safari supports HLS natively, but Chrome, Firefox, and Edge require HLS.js.

```bash
cd youtube-webclient
npm install hls.js
```

### Create `src/app/watch/hls-player.tsx` — Adaptive Video Player

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import styles from "./hls-player.module.css";

interface HlsPlayerProps {
  src: string; // Full URL to master.m3u8
}

interface QualityLevel {
  index: number;
  height: number;
  label: string;
}

export default function HlsPlayer({ src }: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-1); // -1 = auto

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (Hls.isSupported()) {
      const hls = new Hls({
        startLevel: -1, // Start with auto quality selection
        capLevelToPlayerSize: true, // Don't load higher quality than the player viewport
      });

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        // Build the quality level list from the parsed manifest
        const qualityLevels: QualityLevel[] = data.levels.map(
          (level, index) => ({
            index,
            height: level.height,
            label: `${level.height}p`,
          }),
        );
        setLevels(qualityLevels);
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        setCurrentLevel(data.level);
      });

      hlsRef.current = hls;

      return () => {
        hls.destroy();
      };
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari has native HLS support
      video.src = src;
    }
  }, [src]);

  const handleQualityChange = (levelIndex: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelIndex; // -1 = auto
      setCurrentLevel(levelIndex);
    }
  };

  return (
    <div className={styles.playerContainer}>
      <video ref={videoRef} className={styles.video} controls playsInline />

      {levels.length > 0 && (
        <div className={styles.qualitySelector}>
          <span className={styles.qualityLabel}>Quality:</span>
          <button
            className={`${styles.qualityButton} ${
              currentLevel === -1 ? styles.active : ""
            }`}
            onClick={() => handleQualityChange(-1)}
          >
            Auto
          </button>
          {levels.map((level) => (
            <button
              key={level.index}
              className={`${styles.qualityButton} ${
                currentLevel === level.index ? styles.active : ""
              }`}
              onClick={() => handleQualityChange(level.index)}
            >
              {level.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

**How this works:**

- `Hls.isSupported()` checks for MediaSource Extensions (MSE) support — available in Chrome, Firefox, and Edge. Safari uses native HLS and skips HLS.js entirely.
- `startLevel: -1` tells HLS.js to pick the initial quality automatically based on estimated bandwidth.
- `capLevelToPlayerSize: true` prevents loading 720p if the `<video>` element is only 360px tall — saves bandwidth.
- `MANIFEST_PARSED` fires after HLS.js parses the master playlist and knows all available quality levels. The levels are stored in state for the quality selector UI.
- `LEVEL_SWITCHED` fires when HLS.js switches quality (either automatically or manually), keeping the UI in sync.
- `handleQualityChange(-1)` re-enables automatic bitrate adaptation. Setting `currentLevel` to a specific index locks the player to that quality.
- The `useEffect` cleanup calls `hls.destroy()` to release all resources and detach from the video element when the component unmounts.

### Create `src/app/watch/hls-player.module.css`

```css
.playerContainer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  max-width: 960px;
  margin: 0 auto;
}

.video {
  width: 100%;
  max-height: 540px;
  background: #000;
  border-radius: 8px;
}

.qualitySelector {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #f1f1f1;
  border-radius: 8px;
}

.qualityLabel {
  font-family: "Roboto", sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: #606060;
  margin-right: 4px;
}

.qualityButton {
  padding: 6px 14px;
  border: 1px solid #ccc;
  border-radius: 18px;
  background: white;
  font-family: "Roboto", sans-serif;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.qualityButton:hover {
  background: #e8e8e8;
  border-color: #aaa;
}

.qualityButton.active {
  background: #065fd4;
  color: white;
  border-color: #065fd4;
}
```

### Update `src/app/watch/page.tsx` — Use the HLS Player

```tsx
"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import HlsPlayer from "./hls-player";

function VideoPlayer() {
  const videoPrefix =
    "https://storage.googleapis.com/codeyalaya-yt-processed-videos/";
  const searchParams = useSearchParams();
  const videoSrc = searchParams.get("v");

  return (
    <>
      <h1>Watch Page</h1>
      {videoSrc ? (
        <HlsPlayer src={videoPrefix + videoSrc} />
      ) : (
        <p>No video selected</p>
      )}
    </>
  );
}

function Loading() {
  return <p>Loading video player...</p>;
}

export default function Watch() {
  return (
    <div>
      <Suspense fallback={<Loading />}>
        <VideoPlayer />
      </Suspense>
    </div>
  );
}
```

The only change from the original watch page is replacing the plain `<video>` element with the `<HlsPlayer>` component. The `src` is now `<prefix>/<videoId>/master.m3u8` (set by the processing service in Firestore). Everything else — the Suspense boundary, search params, and layout — stays the same.

### Test the Full Pipeline

1. **Upload a video** through the web client's Upload button
2. **Cloud Storage → Pub/Sub → Cloud Run** triggers the processing service
3. **Check Cloud Run logs** — you should see transcoding messages for each variant:
   ```text
   Transcoding 360p finished.
   Transcoding 480p finished.
   Transcoding 720p finished.
   Master playlist generated.
   HLS output for <videoId> uploaded and made public.
   ```
4. **Verify Cloud Storage** — the processed bucket should contain:
   ```text
   <videoId>/master.m3u8
   <videoId>/360p/playlist.m3u8
   <videoId>/360p/segment000.ts
   <videoId>/360p/segment001.ts
   ...
   <videoId>/480p/playlist.m3u8
   <videoId>/480p/segment000.ts
   ...
   <videoId>/720p/playlist.m3u8
   <videoId>/720p/segment000.ts
   ...
   ```
5. **Open the watch page** — the HLS player should load and show quality buttons (Auto, 360p, 480p, 720p)
6. **Test quality switching** — click different quality buttons and observe the resolution change. Open browser DevTools → Network tab to see `.ts` segment requests switch between variants.
7. **Test auto mode** — click Auto, then throttle the network in DevTools (Network → Slow 3G). The player should drop to 360p. Remove throttling and it should climb back to 720p.

---

## Content Delivery Network (CDN)

Up to this point, every viewer fetches `.m3u8` playlists and `.ts` segments directly from the Cloud Storage bucket in `us-central1`. A user in Tokyo or São Paulo makes a round trip to that single region for every segment — adding latency, increasing buffering, and concentrating all egress costs on one location. A **Content Delivery Network** caches content at edge nodes worldwide so subsequent requests are served from the nearest point of presence (PoP).

Google Cloud CDN integrates with Cloud Storage through an **external Application Load Balancer** with a **backend bucket**. Once enabled, the first request for a segment hits the origin (Cloud Storage), and the response is cached at the edge. All following requests for that segment from nearby users are served directly from the edge cache — typically in single-digit milliseconds.

### How CDN Fits the Architecture

```text
Viewer (Browser + HLS.js)
  │
  ▼
Cloud CDN Edge PoP (nearest to viewer)
  │ cache miss? ──▶ Cloud Storage (us-central1)
  │ cache hit?  ──▶ serve directly from edge
  ▼
HLS segments + playlists returned
```

The processing service still uploads to Cloud Storage as before. The only changes are:

1. A load balancer + backend bucket + CDN layer in front of the processed videos bucket.
2. The web client points to the CDN URL instead of the raw Cloud Storage URL.
3. Cache-Control headers on uploaded files so the CDN knows how long to cache them.

### Reserve a Static IP Address

The load balancer needs a global static IP:

```bash
gcloud compute addresses create cdn-video-ip \
  --global \
  --ip-version=IPV4
```

Note the IP address for DNS configuration later:

```bash
gcloud compute addresses describe cdn-video-ip --global --format="value(address)"
```

### Create a Backend Bucket with CDN Enabled

A backend bucket connects the load balancer to Cloud Storage:

```bash
gcloud compute backend-buckets create processed-videos-backend \
  --gcs-bucket-name=codeyalaya-yt-processed-videos \
  --enable-cdn \
  --cache-mode=CACHE_ALL_STATIC \
  --default-ttl=86400 \
  --max-ttl=604800 \
  --client-ttl=3600
```

| Flag                            | Purpose                                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `--enable-cdn`                  | Turns on Cloud CDN caching at edge PoPs                                                                                    |
| `--cache-mode=CACHE_ALL_STATIC` | Caches all responses with static content types (including `.m3u8` and `.ts`) even without explicit `Cache-Control` headers |
| `--default-ttl=86400`           | Edge caches content for 24 hours if the origin doesn't set a `Cache-Control` header                                        |
| `--max-ttl=604800`              | Maximum cache duration is 7 days, even if the origin sets a longer max-age                                                 |
| `--client-ttl=3600`             | Tells the browser to cache for 1 hour via the `Cache-Control` header sent to the client                                    |

### Create a URL Map

The URL map routes incoming requests to the backend bucket:

```bash
gcloud compute url-maps create cdn-video-url-map \
  --default-backend-bucket=processed-videos-backend
```

This is a simple setup with a single backend. In production, you could add path-based routing to serve thumbnails from a different backend.

### Create an HTTPS Target Proxy and Forwarding Rule

For HTTPS (recommended for production), you need an SSL certificate. Google-managed certificates are free and auto-renewing:

```bash
# Create a Google-managed SSL certificate (requires a custom domain)
gcloud compute ssl-certificates create cdn-video-cert \
  --domains=cdn.yourdomain.com \
  --global

# Create the HTTPS target proxy
gcloud compute target-https-proxies create cdn-video-https-proxy \
  --url-map=cdn-video-url-map \
  --ssl-certificates=cdn-video-cert

# Create the forwarding rule (binds the static IP to the proxy)
gcloud compute forwarding-rules create cdn-video-https-rule \
  --global \
  --target-https-proxy=cdn-video-https-proxy \
  --address=cdn-video-ip \
  --ports=443
```

If you don't have a custom domain yet, you can use HTTP for testing:

```bash
# HTTP-only (testing only — not for production)
gcloud compute target-http-proxies create cdn-video-http-proxy \
  --url-map=cdn-video-url-map

gcloud compute forwarding-rules create cdn-video-http-rule \
  --global \
  --target-http-proxy=cdn-video-http-proxy \
  --address=cdn-video-ip \
  --ports=80
```

### Configure DNS

Point your custom domain to the static IP. Add an A record in your DNS provider:

```text
Type: A
Name: cdn
Value: <STATIC_IP_ADDRESS>
TTL: 300
```

The Google-managed SSL certificate will auto-provision once DNS propagation completes (can take up to 24 hours, but usually much faster).

### Set Cache-Control Headers on Uploaded Files

The CDN respects `Cache-Control` headers set on objects in Cloud Storage. Update `uploadHlsOutput` in `src/storage.ts` to set appropriate caching headers:

```typescript
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
          // Playlists are small and should be fresh — short cache
          cacheControl = "public, max-age=60, s-maxage=300";
        } else if (entry.name.endsWith(".ts")) {
          contentType = "video/mp2t";
          // Segments are immutable once written — long cache
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

  const [files] = await bucket.getFiles({ prefix: `${videoId}/` });
  await Promise.all(files.map((file) => file.makePublic()));

  console.log(`HLS output for ${videoId} uploaded and made public.`);
}
```

**Cache strategy explained:**

- **`.m3u8` playlists** — `max-age=60, s-maxage=300`. The browser caches for 1 minute, the CDN edge caches for 5 minutes. For VOD this is conservative; you could increase these values. The separation between `max-age` (browser) and `s-maxage` (CDN/proxy) lets you invalidate at the edge without waiting for browser caches to expire.
- **`.ts` segments** — `max-age=604800, immutable`. Segments never change once written (their content is determined by the segment filename). `immutable` tells the browser to skip revalidation entirely. 7-day cache means segments stay at the edge for a full week, dramatically reducing origin egress.
- The `public` directive is required for CDN caching. Without it, shared caches (CDN edge nodes) may not store the response.

### Update the Web Client — CDN URL

Update the video prefix in the watch page and anywhere else that references the processed videos bucket. Replace the raw Cloud Storage URL with your CDN domain:

```tsx
// Before (direct Cloud Storage)
const videoPrefix =
  "https://storage.googleapis.com/codeyalaya-yt-processed-videos/";

// After (CDN — custom domain)
const videoPrefix = "https://cdn.yourdomain.com/";

// After (CDN — IP-based, HTTP only, for testing)
// const videoPrefix = "http://<STATIC_IP_ADDRESS>/";
```

The path structure stays the same (`<videoId>/master.m3u8`). The CDN transparently proxies to Cloud Storage — no changes to HLS.js, the quality selector, or any other client code.

### Update CORS for the CDN Origin

The processed videos bucket already has CORS configured from the HLS section. If you're using a custom domain, add it to the allowed origins. Create `utils/gcs-cors-cdn.json`:

```json
[
  {
    "origin": [
      "https://cdn.yourdomain.com",
      "https://yt-web-client-v6j6pvk7fq-uc.a.run.app"
    ],
    "responseHeader": ["Content-Type", "Content-Length", "Range"],
    "method": ["GET", "HEAD"],
    "maxAgeSeconds": 86400
  }
]
```

```bash
gcloud storage buckets update gs://codeyalaya-yt-processed-videos \
  --cors-file=utils/gcs-cors-cdn.json
```

Note: `maxAgeSeconds` for CORS is increased to 86400 (24 hours). The CORS preflight response itself is cached by the browser, reducing the number of `OPTIONS` requests. This is separate from content caching.

### Cache Invalidation

When you reprocess a video (e.g., fixing encoding issues), the old segments may still be cached at the edge. Invalidate specific paths or everything under a video ID:

```bash
# Invalidate all cached content for a specific video
gcloud compute url-maps invalidate-cdn-cache cdn-video-url-map \
  --path="/<videoId>/*"

# Invalidate a specific file
gcloud compute url-maps invalidate-cdn-cache cdn-video-url-map \
  --path="/<videoId>/master.m3u8"

# Nuclear option: invalidate everything (use sparingly)
gcloud compute url-maps invalidate-cdn-cache cdn-video-url-map \
  --path="/*"
```

Invalidation is asynchronous and typically completes within a few minutes globally. It does not delete the content from Cloud Storage — it only removes it from edge caches so the next request fetches a fresh copy from the origin.

**Best practice:** Instead of invalidating, use unique filenames. Since segment filenames already contain the video ID and a sequential number, reprocessing a video with a new video ID naturally avoids cache conflicts. Reserve invalidation for cases where you must update content at the same path.

### Monitoring CDN Performance

Google Cloud provides built-in CDN monitoring:

```bash
# View CDN cache hit ratio
gcloud compute backend-buckets describe processed-videos-backend \
  --format="value(cdnPolicy)"
```

In the Cloud Console: **Network services → Cloud CDN** → Select your backend → View metrics:

- **Cache hit ratio** — Percentage of requests served from edge cache. For a video platform with repeat viewers, expect 80–95%+ after warmup.
- **Bandwidth** — Total bytes served, split by cache hit vs. origin fetch.
- **Latency** — Response times broken down by region. Edge-served responses should be under 50ms.
- **Request count** — Total requests by status code. Watch for 404s (missing segments) and 403s (CORS/permissions issues).

You can also check cache behavior from the command line:

```bash
# Check response headers to verify CDN is working
curl -sI "https://cdn.yourdomain.com/<videoId>/360p/segment000.ts" | grep -i -E "(cache|age|x-goog)"
```

Look for:

- `Age: <seconds>` — How long the response has been in the edge cache. If present, the request was a cache hit.
- `X-Goog-Hash` — Confirms the response came from Cloud Storage (via CDN).
- `Cache-Control: public, max-age=604800, immutable` — Confirms your caching headers are being forwarded.
- `Via: 1.1 google` — Confirms the response was proxied through Google's infrastructure.

### Cost Considerations

CDN adds a caching layer but changes the cost structure:

| Cost Component                 | Without CDN                      | With CDN                              |
| ------------------------------ | -------------------------------- | ------------------------------------- |
| **Storage**                    | Same                             | Same                                  |
| **Egress (origin → internet)** | All traffic from `us-central1`   | Only cache misses                     |
| **Egress (CDN → internet)**    | N/A                              | Cache hits served at CDN egress rates |
| **CDN cache fill**             | N/A                              | Origin → edge transfer (per-region)   |
| **HTTP/HTTPS requests**        | Cloud Storage operations pricing | CDN request pricing                   |
| **Cache invalidation**         | N/A                              | Free (up to limits; throttled beyond) |

CDN egress is generally **cheaper per GB** than direct Cloud Storage egress, and the cache hit ratio means most bytes are served from edge — reducing total origin egress significantly. For a video platform, the savings compound because popular videos are requested thousands of times but only fetched from origin once per edge per TTL.

**Estimated savings example:** A 5-minute 720p video is ~100MB. With 10,000 views and a 90% cache hit ratio, only 1,000 requests hit the origin (100GB egress) instead of 10,000 (1TB egress). At GCP's standard egress pricing, that's roughly $85 saved per video.

---

## Design Netflix — Subscription-Based Streaming with Khalti Payment Gateway

This section extends the YouTube architecture into a Netflix-like system where videos are **private by default** and only accessible to users with an active subscription. Instead of `file.makePublic()`, we serve videos through **signed URLs** generated on demand after verifying the user's subscription status. Payments are handled through **Khalti**, Nepal's payment gateway, using their ePayment v2 API.

### Architecture Differences from YouTube

| Aspect             | YouTube (Public)                      | Netflix (Subscription)                          |
| ------------------ | ------------------------------------- | ----------------------------------------------- |
| **Video access**   | `file.makePublic()` — anyone can view | Private bucket — signed URLs only               |
| **Authentication** | Optional for viewing                  | Required for all video access                   |
| **Authorization**  | None                                  | Subscription tier check before serving          |
| **Payment**        | None                                  | Khalti ePayment integration                     |
| **User model**     | Basic profile                         | Profile + subscription status + payment history |
| **Upload**         | Any authenticated user                | Admin-only (content management)                 |

The core video processing pipeline (upload → Pub/Sub → Cloud Run → FFmpeg → HLS) remains identical. The difference is entirely in **how processed videos are served** and **who can access them**.

### Subscription Tiers

Define the subscription plans your platform offers:

```typescript
// src/types/subscription.ts

export interface SubscriptionPlan {
  id: string;
  name: string;
  priceNPR: number; // Price in Nepali Rupees
  pricePaisa: number; // Khalti uses paisa (1 NPR = 100 paisa)
  durationDays: number;
  maxResolution: string; // e.g., "1080p", "4K"
  maxConcurrentStreams: number;
  features: string[];
}

export const SUBSCRIPTION_PLANS: Record<string, SubscriptionPlan> = {
  basic: {
    id: "basic",
    name: "Basic",
    priceNPR: 299,
    pricePaisa: 29900,
    durationDays: 30,
    maxResolution: "720p",
    maxConcurrentStreams: 1,
    features: ["SD & HD streaming", "Watch on 1 device", "Cancel anytime"],
  },
  standard: {
    id: "standard",
    name: "Standard",
    priceNPR: 599,
    pricePaisa: 59900,
    durationDays: 30,
    maxResolution: "1080p",
    maxConcurrentStreams: 2,
    features: [
      "Full HD streaming",
      "Watch on 2 devices",
      "Download for offline",
      "Cancel anytime",
    ],
  },
  premium: {
    id: "premium",
    name: "Premium",
    priceNPR: 999,
    pricePaisa: 99900,
    durationDays: 30,
    maxResolution: "4K",
    maxConcurrentStreams: 4,
    features: [
      "4K + HDR streaming",
      "Watch on 4 devices",
      "Download for offline",
      "Spatial Audio",
      "Cancel anytime",
    ],
  },
};
```

### Firestore Schema

#### Users Collection (Extended)

```
users/{userId}
├── email: string
├── displayName: string
├── photoUrl: string
├── subscription: {
│     status: "active" | "expired" | "cancelled" | "none"
│     planId: "basic" | "standard" | "premium" | null
│     startDate: Timestamp
│     endDate: Timestamp
│     autoRenew: boolean
│     lastPaymentId: string  // Reference to payments collection
│   }
└── createdAt: Timestamp
```

#### Payments Collection

```
payments/{paymentId}
├── userId: string
├── planId: string
├── amountPaisa: number
├── amountNPR: number
├── khaltiPidx: string      // Khalti's payment identifier
├── khaltiTransactionId: string  // After verification
├── status: "initiated" | "completed" | "failed" | "expired" | "refunded"
├── initiatedAt: Timestamp
├── completedAt: Timestamp | null
└── metadata: {
      purchaseOrderId: string
      purchaseOrderName: string
    }
```

#### Subscriptions History Collection

```
subscriptionHistory/{historyId}
├── userId: string
├── planId: string
├── paymentId: string
├── startDate: Timestamp
├── endDate: Timestamp
└── status: "active" | "expired" | "cancelled"
```

### Khalti Payment Gateway — Integration

Khalti's ePayment v2 API uses a server-to-server flow: **Initiate → Redirect → Verify**. Your backend initiates the payment, Khalti handles the checkout UI, and your backend verifies the result. The user never sees your secret key.

#### Environment Configuration

```typescript
// functions/src/config/khalti.ts

export const khaltiConfig = {
  // Use sandbox for development, production for live
  baseUrl:
    process.env.KHALTI_ENV === "production"
      ? "https://khalti.com/api/v2"
      : "https://dev.khalti.com/api/v2",
  secretKey: process.env.KHALTI_SECRET_KEY!,
  returnUrl: process.env.KHALTI_RETURN_URL!, // e.g., https://yourapp.com/payment/callback
  websiteUrl: process.env.WEBSITE_URL!, // e.g., https://yourapp.com
};
```

Store secrets using Firebase environment configuration:

```bash
# Set Khalti secrets (never commit these)
firebase functions:secrets:set KHALTI_SECRET_KEY
firebase functions:secrets:set KHALTI_RETURN_URL
firebase functions:secrets:set KHALTI_ENV
firebase functions:secrets:set WEBSITE_URL
```

#### Khalti Service — Initiate & Verify

```typescript
// functions/src/services/khaltiService.ts

import { khaltiConfig } from "../config/khalti.js";

interface KhaltiInitiateResponse {
  pidx: string;
  payment_url: string;
  expires_at: string;
  expires_in: number;
}

interface KhaltiLookupResponse {
  pidx: string;
  total_amount: number;
  status: "Completed" | "Pending" | "Initiated" | "Expired" | "User canceled";
  transaction_id: string;
  fee: number;
  refunded: boolean;
}

export async function initiateKhaltiPayment(params: {
  amount: number; // in paisa
  purchaseOrderId: string;
  purchaseOrderName: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}): Promise<KhaltiInitiateResponse> {
  const response = await fetch(`${khaltiConfig.baseUrl}/epayment/initiate/`, {
    method: "POST",
    headers: {
      Authorization: `Key ${khaltiConfig.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      return_url: khaltiConfig.returnUrl,
      website_url: khaltiConfig.websiteUrl,
      amount: params.amount,
      purchase_order_id: params.purchaseOrderId,
      purchase_order_name: params.purchaseOrderName,
      customer_info: {
        name: params.customerName,
        email: params.customerEmail,
        phone: params.customerPhone,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Khalti initiation failed: ${error}`);
  }

  return response.json();
}

export async function verifyKhaltiPayment(
  pidx: string,
): Promise<KhaltiLookupResponse> {
  const response = await fetch(`${khaltiConfig.baseUrl}/epayment/lookup/`, {
    method: "POST",
    headers: {
      Authorization: `Key ${khaltiConfig.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pidx }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Khalti lookup failed: ${error}`);
  }

  return response.json();
}
```

### Cloud Functions — Payment Endpoints

#### Initiate Subscription Payment

When a user selects a plan, the frontend calls this function. It creates a payment record in Firestore, initiates the Khalti payment, and returns the `payment_url` for client-side redirect.

```typescript
// functions/src/index.ts (add to existing exports)

import * as functions from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  initiateKhaltiPayment,
  verifyKhaltiPayment,
} from "./services/khaltiService.js";
import { SUBSCRIPTION_PLANS } from "./types/subscription.js";

initializeApp();
const firestore = getFirestore();

export const initiateSubscription = functions.https.onCall(async (request) => {
  // Ensure user is authenticated
  if (!request.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Must be logged in to subscribe.",
    );
  }

  const { planId, phone } = request.data as {
    planId: string;
    phone: string;
  };

  // Validate plan
  const plan = SUBSCRIPTION_PLANS[planId];
  if (!plan) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `Invalid plan: ${planId}`,
    );
  }

  // Check if user already has an active subscription
  const userDoc = await firestore.doc(`users/${request.auth.uid}`).get();
  const userData = userDoc.data();
  if (
    userData?.subscription?.status === "active" &&
    userData?.subscription?.endDate?.toDate() > new Date()
  ) {
    throw new functions.https.HttpsError(
      "already-exists",
      "You already have an active subscription.",
    );
  }

  // Create payment record in Firestore
  const purchaseOrderId = `SUB_${request.auth.uid}_${Date.now()}`;
  const paymentRef = firestore.collection("payments").doc();

  await paymentRef.set({
    userId: request.auth.uid,
    planId: plan.id,
    amountPaisa: plan.pricePaisa,
    amountNPR: plan.priceNPR,
    khaltiPidx: null,
    khaltiTransactionId: null,
    status: "initiated",
    initiatedAt: FieldValue.serverTimestamp(),
    completedAt: null,
    metadata: {
      purchaseOrderId,
      purchaseOrderName: `${plan.name} Plan — ${plan.durationDays} Days`,
    },
  });

  // Initiate Khalti payment
  try {
    const khaltiResponse = await initiateKhaltiPayment({
      amount: plan.pricePaisa,
      purchaseOrderId,
      purchaseOrderName: `${plan.name} Plan — ${plan.durationDays} Days`,
      customerName: request.auth.token.name || "User",
      customerEmail: request.auth.token.email || "",
      customerPhone: phone,
    });

    // Update payment record with Khalti pidx
    await paymentRef.update({
      khaltiPidx: khaltiResponse.pidx,
    });

    return {
      paymentUrl: khaltiResponse.payment_url,
      pidx: khaltiResponse.pidx,
      paymentId: paymentRef.id,
      expiresIn: khaltiResponse.expires_in,
    };
  } catch (error) {
    // Mark payment as failed
    await paymentRef.update({ status: "failed" });
    throw new functions.https.HttpsError(
      "internal",
      "Payment initiation failed. Please try again.",
    );
  }
});
```

#### Verify Payment & Activate Subscription

After Khalti redirects the user back to your `return_url`, the frontend calls this function with the `pidx` to verify the payment and activate the subscription.

```typescript
// functions/src/index.ts (continued)

export const verifySubscriptionPayment = functions.https.onCall(
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Must be logged in.",
      );
    }

    const { pidx } = request.data as { pidx: string };
    if (!pidx) {
      throw new functions.https.HttpsError("invalid-argument", "Missing pidx.");
    }

    // Find the payment record by pidx
    const paymentQuery = await firestore
      .collection("payments")
      .where("khaltiPidx", "==", pidx)
      .where("userId", "==", request.auth.uid)
      .limit(1)
      .get();

    if (paymentQuery.empty) {
      throw new functions.https.HttpsError(
        "not-found",
        "Payment record not found.",
      );
    }

    const paymentDoc = paymentQuery.docs[0];
    const paymentData = paymentDoc.data();

    // Already completed — return early (idempotent)
    if (paymentData.status === "completed") {
      return { status: "already_active", message: "Subscription is active." };
    }

    // Verify with Khalti (server-to-server — never trust frontend params)
    const verification = await verifyKhaltiPayment(pidx);

    if (verification.status !== "Completed") {
      await paymentDoc.ref.update({
        status: verification.status === "User canceled" ? "failed" : "expired",
      });

      return {
        status: "failed",
        message: `Payment ${verification.status.toLowerCase()}. Please try again.`,
      };
    }

    // Verify amount matches (prevent tampering)
    if (verification.total_amount !== paymentData.amountPaisa) {
      await paymentDoc.ref.update({ status: "failed" });
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Payment amount mismatch.",
      );
    }

    // Payment verified — activate subscription
    const plan = SUBSCRIPTION_PLANS[paymentData.planId];
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + plan.durationDays);

    const batch = firestore.batch();

    // Update payment record
    batch.update(paymentDoc.ref, {
      status: "completed",
      khaltiTransactionId: verification.transaction_id,
      completedAt: FieldValue.serverTimestamp(),
    });

    // Update user subscription
    batch.update(firestore.doc(`users/${request.auth.uid}`), {
      subscription: {
        status: "active",
        planId: plan.id,
        startDate: Timestamp.fromDate(now),
        endDate: Timestamp.fromDate(endDate),
        autoRenew: false,
        lastPaymentId: paymentDoc.id,
      },
    });

    // Create subscription history entry
    const historyRef = firestore.collection("subscriptionHistory").doc();
    batch.set(historyRef, {
      userId: request.auth.uid,
      planId: plan.id,
      paymentId: paymentDoc.id,
      startDate: Timestamp.fromDate(now),
      endDate: Timestamp.fromDate(endDate),
      status: "active",
    });

    await batch.commit();

    return {
      status: "success",
      message: "Subscription activated!",
      subscription: {
        planId: plan.id,
        planName: plan.name,
        startDate: now.toISOString(),
        endDate: endDate.toISOString(),
      },
    };
  },
);
```

### Private Video Access — Signed URLs

The critical difference from the YouTube design: videos are **never made public**. Instead, we generate short-lived signed URLs for authenticated subscribers.

#### Remove `makePublic()` from Upload

In the video processing service, replace the public access call with private upload only:

```typescript
// video-processing-service/src/storage.ts (modified)

// BEFORE (YouTube — public access):
// const [files] = await bucket.getFiles({ prefix: `${videoId}/` });
// await Promise.all(files.map((file) => file.makePublic()));

// AFTER (Netflix — private, no makePublic):
// Files are uploaded as private by default. No makePublic() call.
// Access is controlled through signed URLs generated at request time.

async function uploadToProcessedBucket(
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

        let contentType = "application/octet-stream";
        if (entry.name.endsWith(".m3u8")) {
          contentType = "application/vnd.apple.mpegurl";
        } else if (entry.name.endsWith(".ts")) {
          contentType = "video/mp2t";
        }

        // Upload as private — no makePublic()
        await bucket.upload(fullPath, {
          destination,
          metadata: { contentType },
        });
      }
    }
  }

  await uploadRecursive(localDir);
  console.log(`HLS output for ${videoId} uploaded (private).`);
}
```

#### Signed URL Generation Cloud Function

This function checks the user's subscription, then generates short-lived signed URLs for the requested video's HLS files.

```typescript
// functions/src/index.ts (continued)

import { getStorage } from "firebase-admin/storage";

const storage = getStorage();
const processedBucket = storage.bucket("your-processed-videos-bucket");

export const getVideoAccess = functions.https.onCall(async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Must be logged in to watch.",
    );
  }

  const { videoId } = request.data as { videoId: string };

  // Check subscription status
  const userDoc = await firestore.doc(`users/${request.auth.uid}`).get();
  const userData = userDoc.data();

  if (
    !userData?.subscription ||
    userData.subscription.status !== "active" ||
    userData.subscription.endDate.toDate() < new Date()
  ) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Active subscription required to watch videos.",
    );
  }

  // Determine max resolution based on plan
  const plan = SUBSCRIPTION_PLANS[userData.subscription.planId];
  const allowedResolutions = getAllowedResolutions(plan.maxResolution);

  // Generate signed URL for master playlist
  const masterPlaylistFile = processedBucket.file(`${videoId}/master.m3u8`);
  const [masterExists] = await masterPlaylistFile.exists();

  if (!masterExists) {
    throw new functions.https.HttpsError("not-found", "Video not found.");
  }

  // Signed URLs expire in 4 hours — enough for a movie
  const expiration = Date.now() + 4 * 60 * 60 * 1000;

  const [masterUrl] = await masterPlaylistFile.getSignedUrl({
    action: "read",
    expires: expiration,
  });

  // Generate signed URLs for all segment files under this video
  const [files] = await processedBucket.getFiles({
    prefix: `${videoId}/`,
  });

  const signedUrls: Record<string, string> = {};
  for (const file of files) {
    // Filter by allowed resolutions
    const filePath = file.name;
    const shouldInclude = allowedResolutions.some(
      (res) =>
        filePath.includes(`/${res}/`) || filePath === `${videoId}/master.m3u8`,
    );

    if (shouldInclude || filePath.endsWith("master.m3u8")) {
      const [url] = await file.getSignedUrl({
        action: "read",
        expires: expiration,
      });
      // Map original path to signed URL for client-side resolution
      signedUrls[filePath] = url;
    }
  }

  return {
    masterUrl,
    signedUrls,
    expiresAt: new Date(expiration).toISOString(),
    maxResolution: plan.maxResolution,
  };
});

function getAllowedResolutions(maxResolution: string): string[] {
  const all = ["360p", "480p", "720p", "1080p", "4K"];
  const maxIndex = all.indexOf(maxResolution);
  if (maxIndex === -1) return all;
  return all.slice(0, maxIndex + 1);
}
```

### Web Client — Subscription Flow

#### Payment Callback Page

After Khalti redirects the user back, this page extracts the query parameters and verifies the payment:

```tsx
// app/payment/callback/page.tsx

"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/firebase/firebase";

export default function PaymentCallbackPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"verifying" | "success" | "failed">(
    "verifying",
  );
  const [message, setMessage] = useState("Verifying your payment...");

  useEffect(() => {
    const pidx = searchParams.get("pidx");
    const paymentStatus = searchParams.get("status");

    if (!pidx) {
      setStatus("failed");
      setMessage("Invalid payment callback. Missing payment identifier.");
      return;
    }

    // Even if Khalti says "Completed" in the URL, always verify server-side
    const verifyPayment = httpsCallable(functions, "verifySubscriptionPayment");
    verifyPayment({ pidx })
      .then((result: any) => {
        if (
          result.data.status === "success" ||
          result.data.status === "already_active"
        ) {
          setStatus("success");
          setMessage(result.data.message);
          // Redirect to home after 3 seconds
          setTimeout(() => router.push("/"), 3000);
        } else {
          setStatus("failed");
          setMessage(result.data.message);
        }
      })
      .catch((error) => {
        setStatus("failed");
        setMessage(error.message || "Payment verification failed.");
      });
  }, [searchParams, router]);

  return (
    <div className="payment-callback">
      {status === "verifying" && (
        <div className="spinner">
          <div className="loader" />
          <p>{message}</p>
        </div>
      )}
      {status === "success" && (
        <div className="success">
          <h2>✓ Payment Successful</h2>
          <p>{message}</p>
          <p>Redirecting to home...</p>
        </div>
      )}
      {status === "failed" && (
        <div className="error">
          <h2>✗ Payment Failed</h2>
          <p>{message}</p>
          <button onClick={() => router.push("/subscribe")}>Try Again</button>
        </div>
      )}
    </div>
  );
}
```

#### Subscription Plans Page

```tsx
// app/subscribe/page.tsx

"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/firebase/firebase";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "@/firebase/firebase";

const plans = [
  {
    id: "basic",
    name: "Basic",
    price: "रू 299",
    period: "/month",
    resolution: "720p",
    streams: 1,
    features: ["SD & HD streaming", "Watch on 1 device", "Cancel anytime"],
  },
  {
    id: "standard",
    name: "Standard",
    price: "रू 599",
    period: "/month",
    resolution: "1080p",
    streams: 2,
    features: [
      "Full HD streaming",
      "Watch on 2 devices",
      "Download for offline",
      "Cancel anytime",
    ],
    popular: true,
  },
  {
    id: "premium",
    name: "Premium",
    price: "रू 999",
    period: "/month",
    resolution: "4K + HDR",
    streams: 4,
    features: [
      "4K + HDR streaming",
      "Watch on 4 devices",
      "Download for offline",
      "Spatial Audio",
      "Cancel anytime",
    ],
  },
];

export default function SubscribePage() {
  const [user] = useAuthState(auth);
  const [loading, setLoading] = useState<string | null>(null);

  const handleSubscribe = async (planId: string) => {
    if (!user) {
      alert("Please sign in first.");
      return;
    }

    setLoading(planId);

    try {
      const initiateSubscription = httpsCallable(
        functions,
        "initiateSubscription",
      );
      const result: any = await initiateSubscription({
        planId,
        phone: prompt("Enter your phone number for Khalti:") || "",
      });

      // Redirect to Khalti checkout
      window.location.href = result.data.paymentUrl;
    } catch (error: any) {
      alert(error.message || "Failed to initiate payment.");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="subscribe-page">
      <h1>Choose Your Plan</h1>
      <p>Watch unlimited movies and shows. Cancel anytime.</p>

      <div className="plans-grid">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`plan-card ${plan.popular ? "popular" : ""}`}
          >
            {plan.popular && <span className="badge">Most Popular</span>}
            <h2>{plan.name}</h2>
            <div className="price">
              <span className="amount">{plan.price}</span>
              <span className="period">{plan.period}</span>
            </div>
            <p className="resolution">Up to {plan.resolution}</p>
            <p className="streams">{plan.streams} concurrent stream(s)</p>
            <ul>
              {plan.features.map((f) => (
                <li key={f}>✓ {f}</li>
              ))}
            </ul>
            <button
              onClick={() => handleSubscribe(plan.id)}
              disabled={loading === plan.id}
            >
              {loading === plan.id ? "Processing..." : "Pay with Khalti"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

#### Subscription Guard — Protect Video Pages

Wrap the watch page with a guard that checks subscription status before loading the video player:

```tsx
// components/SubscriptionGuard.tsx

"use client";

import { useEffect, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "@/firebase/firebase";

interface Props {
  children: ReactNode;
}

export default function SubscriptionGuard({ children }: Props) {
  const [user, authLoading] = useAuthState(auth);
  const [hasAccess, setHasAccess] = useState(false);
  const [checking, setChecking] = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      router.push("/login");
      return;
    }

    const checkSubscription = async () => {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      const data = userDoc.data();

      if (
        data?.subscription?.status === "active" &&
        data?.subscription?.endDate?.toDate() > new Date()
      ) {
        setHasAccess(true);
      } else {
        router.push("/subscribe");
      }
      setChecking(false);
    };

    checkSubscription();
  }, [user, authLoading, router]);

  if (authLoading || checking) {
    return <div className="loading">Checking access...</div>;
  }

  return hasAccess ? <>{children}</> : null;
}
```

Use it in the watch page:

```tsx
// app/watch/page.tsx (modified)

import SubscriptionGuard from "@/components/SubscriptionGuard";
import VideoPlayer from "@/components/VideoPlayer";

export default function WatchPage() {
  return (
    <SubscriptionGuard>
      <VideoPlayer />
    </SubscriptionGuard>
  );
}
```

### Video Player — Signed URL Integration

The player needs to use signed URLs instead of public URLs. Since HLS playlists reference segment files by relative path, and signed URLs include query parameters, we need a custom loader:

```tsx
// components/VideoPlayer.tsx (Netflix version)

"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/firebase/firebase";
import Hls from "hls.js";

export default function VideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const searchParams = useSearchParams();
  const videoId = searchParams.get("v");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!videoId || !videoRef.current) return;

    const loadVideo = async () => {
      try {
        // Request signed URLs from backend
        const getAccess = httpsCallable(functions, "getVideoAccess");
        const result: any = await getAccess({ videoId });

        const { masterUrl, signedUrls } = result.data;

        if (Hls.isSupported()) {
          const hls = new Hls({
            // Custom loader to rewrite segment URLs to signed versions
            xhrSetup: (xhr, url) => {
              // Find the matching signed URL for this segment
              const matchingKey = Object.keys(signedUrls).find((key) =>
                url.includes(key),
              );
              if (matchingKey) {
                xhr.open("GET", signedUrls[matchingKey], true);
              }
            },
          });

          hls.loadSource(masterUrl);
          hls.attachMedia(videoRef.current);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            setLoading(false);
          });

          hls.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal) {
              setError("Failed to load video. Please try again.");
            }
          });

          return () => hls.destroy();
        } else if (
          videoRef.current.canPlayType("application/vnd.apple.mpegurl")
        ) {
          // Safari native HLS — use master signed URL directly
          videoRef.current.src = masterUrl;
          setLoading(false);
        }
      } catch (err: any) {
        setError(
          err.message || "Access denied. Please check your subscription.",
        );
        setLoading(false);
      }
    };

    loadVideo();
  }, [videoId]);

  if (error) {
    return <div className="video-error">{error}</div>;
  }

  return (
    <div className="video-player-container">
      {loading && <div className="video-loading">Loading video...</div>}
      <video
        ref={videoRef}
        controls
        className="video-player"
        style={{ display: loading ? "none" : "block" }}
      />
    </div>
  );
}
```

### Subscription Expiry — Scheduled Cleanup

Use a scheduled Cloud Function to expire subscriptions that have passed their end date:

```typescript
// functions/src/index.ts (continued)

export const checkExpiredSubscriptions = functions.pubsub
  .schedule("every 1 hours")
  .onRun(async () => {
    const now = Timestamp.now();

    // Find users with active subscriptions that have passed their end date
    const expiredQuery = await firestore
      .collection("users")
      .where("subscription.status", "==", "active")
      .where("subscription.endDate", "<", now)
      .get();

    const batch = firestore.batch();
    let count = 0;

    for (const doc of expiredQuery.docs) {
      batch.update(doc.ref, {
        "subscription.status": "expired",
      });

      // Update subscription history
      const historyQuery = await firestore
        .collection("subscriptionHistory")
        .where("userId", "==", doc.id)
        .where("status", "==", "active")
        .get();

      for (const historyDoc of historyQuery.docs) {
        batch.update(historyDoc.ref, { status: "expired" });
      }

      count++;
    }

    if (count > 0) {
      await batch.commit();
      console.log(`Expired ${count} subscriptions.`);
    }
  });
```

### Khalti Sandbox Testing

For development, use Khalti's sandbox environment with these test credentials:

| Field               | Value                             |
| ------------------- | --------------------------------- |
| **Sandbox URL**     | `https://dev.khalti.com/api/v2/`  |
| **Test Khalti IDs** | `9800000000` through `9800000005` |
| **Login OTP**       | `987654`                          |
| **MPIN**            | `1111`                            |

Register for a sandbox merchant account at [Khalti's developer portal](https://dev.khalti.com/) to get your test secret key.

### Payment Flow — End to End

```
User selects plan → Frontend calls initiateSubscription() →
  → Cloud Function creates Firestore payment record
  → Cloud Function POSTs to Khalti /epayment/initiate/
  → Khalti returns { pidx, payment_url }
  → Cloud Function returns payment_url to frontend

Frontend redirects user to payment_url →
  → User completes payment on Khalti's checkout page
  → Khalti redirects user to return_url with ?pidx=...&status=Completed

Frontend (callback page) calls verifySubscriptionPayment({ pidx }) →
  → Cloud Function POSTs to Khalti /epayment/lookup/
  → Khalti returns { status: "Completed", transaction_id }
  → Cloud Function verifies amount matches
  → Cloud Function activates subscription in Firestore (batch write)
  → Returns success to frontend

User requests video → Frontend calls getVideoAccess({ videoId }) →
  → Cloud Function checks subscription.status === "active"
  → Cloud Function checks subscription.endDate > now
  → Cloud Function checks plan's maxResolution
  → Cloud Function generates signed URLs (4-hour expiry)
  → Returns signed URLs to frontend

Frontend loads HLS player with signed URLs →
  → Custom XHR loader rewrites segment requests to signed URLs
  → Video plays (private bucket, no public access)
```

### Security Considerations

1. **Server-side verification is mandatory.** Never trust the `status` query parameter from Khalti's redirect. Always call `/epayment/lookup/` from your backend.

2. **Amount validation.** After verification, compare `verification.total_amount` against your Firestore payment record. This prevents users from paying a lower amount through request manipulation.

3. **Idempotent verification.** The `verifySubscriptionPayment` function checks if the payment is already completed before processing. This handles duplicate callbacks safely.

4. **Signed URL expiration.** URLs expire after 4 hours. For long movies, consider refreshing URLs mid-playback via a heartbeat mechanism.

5. **Concurrent stream limiting.** Track active sessions in Firestore (keyed by user ID + device fingerprint). Before generating signed URLs, check that the user hasn't exceeded their plan's `maxConcurrentStreams`.

6. **Secret key rotation.** Store the Khalti secret key in Firebase secrets (not environment variables or code). Rotate keys periodically via the Khalti merchant dashboard.

---

## Design Udemy — Per-Course Purchase with Khalti Payment Gateway

This section builds on the same GCP infrastructure to create a Udemy-like platform where users **purchase individual courses** rather than subscribing to the entire library. Each course has its own price, and a user gains lifetime access to a course after a one-time payment through **Khalti**. Instructors upload course content, and the platform takes a revenue split.

### Architecture Differences — Netflix vs Udemy

| Aspect                   | Netflix (Subscription)          | Udemy (Per-Course Purchase)                    |
| ------------------------ | ------------------------------- | ---------------------------------------------- |
| **Access model**         | All content for one monthly fee | Individual course purchase (lifetime access)   |
| **Payment frequency**    | Recurring monthly               | One-time per course                            |
| **Content organization** | Flat video library              | Courses → Sections → Lessons (videos)          |
| **Content creators**     | Platform only (admin)           | Any approved instructor can upload             |
| **Revenue model**        | Subscription revenue            | Per-sale revenue split (platform + instructor) |
| **Progress tracking**    | Optional (continue watching)    | Essential (completion %, certificates)         |
| **Pricing**              | Fixed tiers                     | Instructor sets price per course               |
| **Video access**         | All videos if subscribed        | Only videos in purchased courses               |

The video processing pipeline remains the same. The differences are in **content structure**, **who uploads**, **payment per item**, and **access control per course**.

### Firestore Schema

#### Courses Collection

```
courses/{courseId}
├── title: string
├── slug: string                    // URL-friendly identifier
├── description: string
├── shortDescription: string        // For cards/listings
├── thumbnailUrl: string
├── previewVideoId: string | null   // Free preview video
├── instructorId: string            // Reference to users collection
├── instructorName: string          // Denormalized for listing
├── priceNPR: number                // Price in Nepali Rupees
├── pricePaisa: number              // For Khalti (1 NPR = 100 paisa)
├── originalPriceNPR: number | null // Strike-through price for discounts
├── category: string
├── tags: string[]
├── level: "beginner" | "intermediate" | "advanced"
├── language: string
├── status: "draft" | "published" | "archived"
├── totalDurationSeconds: number    // Sum of all lesson durations
├── totalLessons: number
├── totalSections: number
├── enrollmentCount: number         // Denormalized counter
├── averageRating: number
├── ratingCount: number
├── sections: [                     // Ordered array of sections
│     {
│       id: string
│       title: string
│       order: number
│       lessons: [
│         {
│           id: string
│           title: string
│           videoId: string         // Reference to processed video
│           durationSeconds: number
│           order: number
│           isFreePreview: boolean  // Some lessons can be free
│         }
│       ]
│     }
│   ]
├── requirements: string[]          // Prerequisites
├── learningObjectives: string[]    // What you'll learn
├── createdAt: Timestamp
└── updatedAt: Timestamp
```

#### Enrollments Collection

```
enrollments/{enrollmentId}
├── userId: string
├── courseId: string
├── paymentId: string               // Reference to payments collection
├── enrolledAt: Timestamp
├── status: "active" | "refunded"
├── progress: {
│     completedLessons: string[]    // Array of lesson IDs
│     lastLessonId: string | null
│     lastAccessedAt: Timestamp
│     completionPercent: number     // 0–100
│   }
└── certificateIssued: boolean
```

#### Payments Collection (Extended for Courses)

```
payments/{paymentId}
├── userId: string
├── type: "course_purchase"          // Distinguishes from subscription payments
├── courseId: string
├── instructorId: string
├── amountPaisa: number
├── amountNPR: number
├── platformFeeNPR: number           // Platform's cut
├── instructorEarningsNPR: number    // Instructor's cut
├── khaltiPidx: string
├── khaltiTransactionId: string
├── status: "initiated" | "completed" | "failed" | "expired" | "refunded"
├── initiatedAt: Timestamp
├── completedAt: Timestamp | null
├── refundedAt: Timestamp | null
└── metadata: {
      purchaseOrderId: string
      purchaseOrderName: string
    }
```

#### Instructor Earnings Collection

```
instructorEarnings/{instructorId}
├── totalEarningsNPR: number
├── pendingPayoutNPR: number
├── paidOutNPR: number
├── totalSales: number
├── courses: {
│     [courseId]: {
│       sales: number
│       earningsNPR: number
│     }
│   }
└── lastUpdated: Timestamp
```

### Course & Enrollment Types

```typescript
// src/types/course.ts

export interface Lesson {
  id: string;
  title: string;
  videoId: string;
  durationSeconds: number;
  order: number;
  isFreePreview: boolean;
}

export interface Section {
  id: string;
  title: string;
  order: number;
  lessons: Lesson[];
}

export interface Course {
  id?: string;
  title: string;
  slug: string;
  description: string;
  shortDescription: string;
  thumbnailUrl: string;
  previewVideoId: string | null;
  instructorId: string;
  instructorName: string;
  priceNPR: number;
  pricePaisa: number;
  originalPriceNPR: number | null;
  category: string;
  tags: string[];
  level: "beginner" | "intermediate" | "advanced";
  language: string;
  status: "draft" | "published" | "archived";
  totalDurationSeconds: number;
  totalLessons: number;
  totalSections: number;
  enrollmentCount: number;
  averageRating: number;
  ratingCount: number;
  sections: Section[];
  requirements: string[];
  learningObjectives: string[];
}

export interface Enrollment {
  id?: string;
  userId: string;
  courseId: string;
  paymentId: string;
  enrolledAt: Date;
  status: "active" | "refunded";
  progress: {
    completedLessons: string[];
    lastLessonId: string | null;
    lastAccessedAt: Date;
    completionPercent: number;
  };
  certificateIssued: boolean;
}

// Revenue split configuration
export const PLATFORM_FEE_PERCENT = 30; // Platform takes 30%
export const INSTRUCTOR_SHARE_PERCENT = 70; // Instructor keeps 70%
```

### Cloud Functions — Course Management

#### Create Course (Instructor)

```typescript
// functions/src/index.ts (add to existing exports)

export const createCourse = functions.https.onCall(async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Must be logged in.",
    );
  }

  // Verify user is an approved instructor
  const userDoc = await firestore.doc(`users/${request.auth.uid}`).get();
  const userData = userDoc.data();
  if (userData?.role !== "instructor") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only approved instructors can create courses.",
    );
  }

  const courseData = request.data as Omit<
    Course,
    | "id"
    | "instructorId"
    | "instructorName"
    | "enrollmentCount"
    | "averageRating"
    | "ratingCount"
    | "status"
  >;

  const slug = courseData.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  // Calculate totals from sections
  let totalLessons = 0;
  let totalDurationSeconds = 0;
  for (const section of courseData.sections) {
    totalLessons += section.lessons.length;
    for (const lesson of section.lessons) {
      totalDurationSeconds += lesson.durationSeconds;
    }
  }

  const courseRef = firestore.collection("courses").doc();
  await courseRef.set({
    ...courseData,
    slug,
    instructorId: request.auth.uid,
    instructorName: userData.displayName || "Instructor",
    status: "draft", // Requires review before publishing
    enrollmentCount: 0,
    averageRating: 0,
    ratingCount: 0,
    totalLessons,
    totalSections: courseData.sections.length,
    totalDurationSeconds,
    pricePaisa: courseData.priceNPR * 100,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { courseId: courseRef.id, slug };
});
```

#### Publish Course (Admin Review)

```typescript
// functions/src/index.ts (continued)

export const publishCourse = functions.https.onCall(async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Must be logged in.",
    );
  }

  const { courseId } = request.data as { courseId: string };

  const courseDoc = await firestore.doc(`courses/${courseId}`).get();
  const courseData = courseDoc.data();

  if (!courseData) {
    throw new functions.https.HttpsError("not-found", "Course not found.");
  }

  // Only the instructor or an admin can publish
  const userDoc = await firestore.doc(`users/${request.auth.uid}`).get();
  const userData = userDoc.data();
  const isOwner = courseData.instructorId === request.auth.uid;
  const isAdmin = userData?.role === "admin";

  if (!isOwner && !isAdmin) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Not authorized to publish this course.",
    );
  }

  // Validate course has content
  if (!courseData.sections || courseData.sections.length === 0) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Course must have at least one section with lessons.",
    );
  }

  await courseDoc.ref.update({
    status: "published",
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { status: "published" };
});
```

### Cloud Functions — Course Purchase with Khalti

#### Initiate Course Purchase

When a user clicks "Buy This Course", the frontend calls this function. It checks that the user hasn't already purchased the course, creates a payment record, and initiates the Khalti payment.

```typescript
// functions/src/index.ts (continued)

import {
  initiateKhaltiPayment,
  verifyKhaltiPayment,
} from "./services/khaltiService.js";
import {
  PLATFORM_FEE_PERCENT,
  INSTRUCTOR_SHARE_PERCENT,
} from "./types/course.js";

export const initiateCoursePurchase = functions.https.onCall(
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Must be logged in to purchase.",
      );
    }

    const { courseId, phone } = request.data as {
      courseId: string;
      phone: string;
    };

    // Fetch course details
    const courseDoc = await firestore.doc(`courses/${courseId}`).get();
    const course = courseDoc.data();

    if (!course || course.status !== "published") {
      throw new functions.https.HttpsError(
        "not-found",
        "Course not found or not available.",
      );
    }

    // Check if user already owns this course
    const existingEnrollment = await firestore
      .collection("enrollments")
      .where("userId", "==", request.auth.uid)
      .where("courseId", "==", courseId)
      .where("status", "==", "active")
      .limit(1)
      .get();

    if (!existingEnrollment.empty) {
      throw new functions.https.HttpsError(
        "already-exists",
        "You already own this course.",
      );
    }

    // Calculate revenue split
    const platformFeeNPR = Math.round(
      (course.priceNPR * PLATFORM_FEE_PERCENT) / 100,
    );
    const instructorEarningsNPR = course.priceNPR - platformFeeNPR;

    // Create payment record
    const purchaseOrderId = `COURSE_${courseId}_${request.auth.uid}_${Date.now()}`;
    const paymentRef = firestore.collection("payments").doc();

    await paymentRef.set({
      userId: request.auth.uid,
      type: "course_purchase",
      courseId,
      instructorId: course.instructorId,
      amountPaisa: course.pricePaisa,
      amountNPR: course.priceNPR,
      platformFeeNPR,
      instructorEarningsNPR,
      khaltiPidx: null,
      khaltiTransactionId: null,
      status: "initiated",
      initiatedAt: FieldValue.serverTimestamp(),
      completedAt: null,
      refundedAt: null,
      metadata: {
        purchaseOrderId,
        purchaseOrderName: course.title,
      },
    });

    // Initiate Khalti payment
    try {
      const khaltiResponse = await initiateKhaltiPayment({
        amount: course.pricePaisa,
        purchaseOrderId,
        purchaseOrderName: course.title,
        customerName: request.auth.token.name || "User",
        customerEmail: request.auth.token.email || "",
        customerPhone: phone,
      });

      await paymentRef.update({
        khaltiPidx: khaltiResponse.pidx,
      });

      return {
        paymentUrl: khaltiResponse.payment_url,
        pidx: khaltiResponse.pidx,
        paymentId: paymentRef.id,
        expiresIn: khaltiResponse.expires_in,
      };
    } catch (error) {
      await paymentRef.update({ status: "failed" });
      throw new functions.https.HttpsError(
        "internal",
        "Payment initiation failed. Please try again.",
      );
    }
  },
);
```

#### Verify Course Purchase & Create Enrollment

After Khalti redirects the user back, verify the payment and create the enrollment record that grants course access.

```typescript
// functions/src/index.ts (continued)

export const verifyCoursePurchase = functions.https.onCall(async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Must be logged in.",
    );
  }

  const { pidx } = request.data as { pidx: string };
  if (!pidx) {
    throw new functions.https.HttpsError("invalid-argument", "Missing pidx.");
  }

  // Find payment record
  const paymentQuery = await firestore
    .collection("payments")
    .where("khaltiPidx", "==", pidx)
    .where("userId", "==", request.auth.uid)
    .limit(1)
    .get();

  if (paymentQuery.empty) {
    throw new functions.https.HttpsError(
      "not-found",
      "Payment record not found.",
    );
  }

  const paymentDoc = paymentQuery.docs[0];
  const paymentData = paymentDoc.data();

  // Idempotent — already processed
  if (paymentData.status === "completed") {
    return {
      status: "already_enrolled",
      message: "You already own this course.",
    };
  }

  // Verify with Khalti
  const verification = await verifyKhaltiPayment(pidx);

  if (verification.status !== "Completed") {
    await paymentDoc.ref.update({
      status: verification.status === "User canceled" ? "failed" : "expired",
    });
    return {
      status: "failed",
      message: `Payment ${verification.status.toLowerCase()}. Please try again.`,
    };
  }

  // Verify amount
  if (verification.total_amount !== paymentData.amountPaisa) {
    await paymentDoc.ref.update({ status: "failed" });
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Payment amount mismatch.",
    );
  }

  // Payment verified — create enrollment and update records
  const batch = firestore.batch();

  // 1. Update payment status
  batch.update(paymentDoc.ref, {
    status: "completed",
    khaltiTransactionId: verification.transaction_id,
    completedAt: FieldValue.serverTimestamp(),
  });

  // 2. Create enrollment
  const enrollmentRef = firestore.collection("enrollments").doc();
  batch.set(enrollmentRef, {
    userId: request.auth.uid,
    courseId: paymentData.courseId,
    paymentId: paymentDoc.id,
    enrolledAt: FieldValue.serverTimestamp(),
    status: "active",
    progress: {
      completedLessons: [],
      lastLessonId: null,
      lastAccessedAt: FieldValue.serverTimestamp(),
      completionPercent: 0,
    },
    certificateIssued: false,
  });

  // 3. Increment course enrollment count
  batch.update(firestore.doc(`courses/${paymentData.courseId}`), {
    enrollmentCount: FieldValue.increment(1),
  });

  // 4. Update instructor earnings
  const earningsRef = firestore.doc(
    `instructorEarnings/${paymentData.instructorId}`,
  );
  const earningsDoc = await earningsRef.get();

  if (earningsDoc.exists) {
    batch.update(earningsRef, {
      totalEarningsNPR: FieldValue.increment(paymentData.instructorEarningsNPR),
      pendingPayoutNPR: FieldValue.increment(paymentData.instructorEarningsNPR),
      totalSales: FieldValue.increment(1),
      [`courses.${paymentData.courseId}.sales`]: FieldValue.increment(1),
      [`courses.${paymentData.courseId}.earningsNPR`]: FieldValue.increment(
        paymentData.instructorEarningsNPR,
      ),
      lastUpdated: FieldValue.serverTimestamp(),
    });
  } else {
    batch.set(earningsRef, {
      totalEarningsNPR: paymentData.instructorEarningsNPR,
      pendingPayoutNPR: paymentData.instructorEarningsNPR,
      paidOutNPR: 0,
      totalSales: 1,
      courses: {
        [paymentData.courseId]: {
          sales: 1,
          earningsNPR: paymentData.instructorEarningsNPR,
        },
      },
      lastUpdated: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();

  return {
    status: "success",
    message: "Course purchased! You now have lifetime access.",
    enrollmentId: enrollmentRef.id,
  };
});
```

### Lesson Video Access — Enrollment Check

Unlike Netflix where any subscribed user can watch any video, Udemy requires checking that the user has purchased **this specific course** before serving the lesson video.

```typescript
// functions/src/index.ts (continued)

export const getLessonAccess = functions.https.onCall(async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Must be logged in to watch.",
    );
  }

  const { courseId, lessonId } = request.data as {
    courseId: string;
    lessonId: string;
  };

  // Fetch course to find the lesson and check if it's a free preview
  const courseDoc = await firestore.doc(`courses/${courseId}`).get();
  const course = courseDoc.data();

  if (!course) {
    throw new functions.https.HttpsError("not-found", "Course not found.");
  }

  // Find the lesson in the course sections
  let targetLesson: { videoId: string; isFreePreview: boolean } | null = null;
  for (const section of course.sections) {
    for (const lesson of section.lessons) {
      if (lesson.id === lessonId) {
        targetLesson = lesson;
        break;
      }
    }
    if (targetLesson) break;
  }

  if (!targetLesson) {
    throw new functions.https.HttpsError("not-found", "Lesson not found.");
  }

  // Free preview lessons don't require enrollment
  if (!targetLesson.isFreePreview) {
    // Check enrollment
    const enrollmentQuery = await firestore
      .collection("enrollments")
      .where("userId", "==", request.auth.uid)
      .where("courseId", "==", courseId)
      .where("status", "==", "active")
      .limit(1)
      .get();

    if (enrollmentQuery.empty) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "You must purchase this course to watch this lesson.",
      );
    }
  }

  // Generate signed URLs for this lesson's video
  const videoId = targetLesson.videoId;
  const processedBucket = storage.bucket("your-processed-videos-bucket");

  const masterPlaylistFile = processedBucket.file(`${videoId}/master.m3u8`);
  const [exists] = await masterPlaylistFile.exists();

  if (!exists) {
    throw new functions.https.HttpsError(
      "not-found",
      "Video not yet processed.",
    );
  }

  // Signed URLs expire in 6 hours — enough for long lectures
  const expiration = Date.now() + 6 * 60 * 60 * 1000;

  const [masterUrl] = await masterPlaylistFile.getSignedUrl({
    action: "read",
    expires: expiration,
  });

  // Generate signed URLs for all segment files
  const [files] = await processedBucket.getFiles({
    prefix: `${videoId}/`,
  });

  const signedUrls: Record<string, string> = {};
  for (const file of files) {
    const [url] = await file.getSignedUrl({
      action: "read",
      expires: expiration,
    });
    signedUrls[file.name] = url;
  }

  return {
    masterUrl,
    signedUrls,
    expiresAt: new Date(expiration).toISOString(),
  };
});
```

### Progress Tracking

Track which lessons a user has completed and update their overall course progress:

```typescript
// functions/src/index.ts (continued)

export const markLessonComplete = functions.https.onCall(async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Must be logged in.",
    );
  }

  const { courseId, lessonId } = request.data as {
    courseId: string;
    lessonId: string;
  };

  // Find enrollment
  const enrollmentQuery = await firestore
    .collection("enrollments")
    .where("userId", "==", request.auth.uid)
    .where("courseId", "==", courseId)
    .where("status", "==", "active")
    .limit(1)
    .get();

  if (enrollmentQuery.empty) {
    throw new functions.https.HttpsError("not-found", "Enrollment not found.");
  }

  const enrollmentDoc = enrollmentQuery.docs[0];
  const enrollment = enrollmentDoc.data();

  // Skip if already completed
  if (enrollment.progress.completedLessons.includes(lessonId)) {
    return { status: "already_completed" };
  }

  // Get total lessons count from course
  const courseDoc = await firestore.doc(`courses/${courseId}`).get();
  const course = courseDoc.data();
  const totalLessons = course?.totalLessons || 1;

  // Update progress
  const newCompletedLessons = [
    ...enrollment.progress.completedLessons,
    lessonId,
  ];
  const completionPercent = Math.round(
    (newCompletedLessons.length / totalLessons) * 100,
  );

  await enrollmentDoc.ref.update({
    "progress.completedLessons": FieldValue.arrayUnion(lessonId),
    "progress.lastLessonId": lessonId,
    "progress.lastAccessedAt": FieldValue.serverTimestamp(),
    "progress.completionPercent": completionPercent,
  });

  // Issue certificate if 100% complete
  if (completionPercent === 100 && !enrollment.certificateIssued) {
    await enrollmentDoc.ref.update({ certificateIssued: true });
    // Optionally trigger certificate generation here
  }

  return {
    status: "completed",
    completionPercent,
    certificateIssued: completionPercent === 100,
  };
});
```

### Web Client — Course Listing Page

```tsx
// app/courses/page.tsx

"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import Link from "next/link";

interface CourseCard {
  id: string;
  title: string;
  shortDescription: string;
  thumbnailUrl: string;
  instructorName: string;
  priceNPR: number;
  originalPriceNPR: number | null;
  averageRating: number;
  ratingCount: number;
  enrollmentCount: number;
  totalDurationSeconds: number;
  totalLessons: number;
  level: string;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function CoursesPage() {
  const [courses, setCourses] = useState<CourseCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCourses = async () => {
      const q = query(
        collection(db, "courses"),
        where("status", "==", "published"),
        orderBy("enrollmentCount", "desc"),
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as CourseCard[];
      setCourses(data);
      setLoading(false);
    };

    fetchCourses();
  }, []);

  if (loading) return <div className="loading">Loading courses...</div>;

  return (
    <div className="courses-page">
      <h1>All Courses</h1>
      <div className="courses-grid">
        {courses.map((course) => (
          <Link
            key={course.id}
            href={`/courses/${course.id}`}
            className="course-card"
          >
            <img
              src={course.thumbnailUrl}
              alt={course.title}
              className="course-thumbnail"
            />
            <div className="course-info">
              <h3>{course.title}</h3>
              <p className="instructor">{course.instructorName}</p>
              <div className="rating">
                <span className="stars">
                  {"★".repeat(Math.round(course.averageRating))}
                  {"☆".repeat(5 - Math.round(course.averageRating))}
                </span>
                <span className="count">({course.ratingCount})</span>
              </div>
              <div className="meta">
                <span>{formatDuration(course.totalDurationSeconds)}</span>
                <span>•</span>
                <span>{course.totalLessons} lessons</span>
                <span>•</span>
                <span>{course.level}</span>
              </div>
              <div className="price">
                <span className="current">रू {course.priceNPR}</span>
                {course.originalPriceNPR && (
                  <span className="original">रू {course.originalPriceNPR}</span>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

### Web Client — Course Detail Page

```tsx
// app/courses/[courseId]/page.tsx

"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/firebase/firebase";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "@/firebase/firebase";
import type { Course } from "@/types/course";

export default function CourseDetailPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const [user] = useAuthState(auth);
  const [course, setCourse] = useState<Course | null>(null);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const fetchCourse = async () => {
      const courseDoc = await getDoc(doc(db, "courses", courseId));
      if (courseDoc.exists()) {
        setCourse({ id: courseDoc.id, ...courseDoc.data() } as Course);
      }

      // Check if user is enrolled
      if (user) {
        const { getDocs, query, collection, where } =
          await import("firebase/firestore");
        const enrollmentQuery = query(
          collection(db, "enrollments"),
          where("userId", "==", user.uid),
          where("courseId", "==", courseId),
          where("status", "==", "active"),
        );
        const enrollment = await getDocs(enrollmentQuery);
        setIsEnrolled(!enrollment.empty);
      }

      setLoading(false);
    };

    fetchCourse();
  }, [courseId, user]);

  const handlePurchase = async () => {
    if (!user) {
      router.push("/login");
      return;
    }

    setPurchasing(true);
    try {
      const initiate = httpsCallable(functions, "initiateCoursePurchase");
      const result: any = await initiate({
        courseId,
        phone: prompt("Enter your phone number for Khalti:") || "",
      });
      // Redirect to Khalti checkout
      window.location.href = result.data.paymentUrl;
    } catch (error: any) {
      alert(error.message || "Failed to initiate purchase.");
    } finally {
      setPurchasing(false);
    }
  };

  if (loading || !course) {
    return <div className="loading">Loading course...</div>;
  }

  return (
    <div className="course-detail">
      <div className="course-header">
        <div className="course-header-content">
          <h1>{course.title}</h1>
          <p className="description">{course.shortDescription}</p>
          <div className="meta">
            <span>By {course.instructorName}</span>
            <span>•</span>
            <span>
              {"★".repeat(Math.round(course.averageRating))} (
              {course.ratingCount} ratings)
            </span>
            <span>•</span>
            <span>{course.enrollmentCount} students</span>
          </div>
          <div className="tags">
            <span className="level">{course.level}</span>
            <span className="language">{course.language}</span>
          </div>
        </div>
        <div className="course-purchase-card">
          <div className="price-section">
            <span className="price">रू {course.priceNPR}</span>
            {course.originalPriceNPR && (
              <span className="original-price">
                रू {course.originalPriceNPR}
              </span>
            )}
          </div>
          {isEnrolled ? (
            <button
              className="enrolled-btn"
              onClick={() => router.push(`/courses/${courseId}/learn`)}
            >
              Continue Learning
            </button>
          ) : (
            <button
              className="purchase-btn"
              onClick={handlePurchase}
              disabled={purchasing}
            >
              {purchasing ? "Processing..." : "Buy with Khalti"}
            </button>
          )}
          <ul className="includes">
            <li>
              {Math.floor(course.totalDurationSeconds / 3600)}+ hours of video
            </li>
            <li>{course.totalLessons} lessons</li>
            <li>Lifetime access</li>
            <li>Certificate of completion</li>
          </ul>
        </div>
      </div>

      {/* What you'll learn */}
      <div className="learning-objectives">
        <h2>What you'll learn</h2>
        <ul>
          {course.learningObjectives.map((obj, i) => (
            <li key={i}>✓ {obj}</li>
          ))}
        </ul>
      </div>

      {/* Requirements */}
      <div className="requirements">
        <h2>Requirements</h2>
        <ul>
          {course.requirements.map((req, i) => (
            <li key={i}>{req}</li>
          ))}
        </ul>
      </div>

      {/* Course content */}
      <div className="course-content">
        <h2>Course Content</h2>
        <p>
          {course.totalSections} sections • {course.totalLessons} lessons •{" "}
          {Math.floor(course.totalDurationSeconds / 3600)}h{" "}
          {Math.floor((course.totalDurationSeconds % 3600) / 60)}m total
        </p>
        {course.sections.map((section) => (
          <div key={section.id} className="section">
            <h3>{section.title}</h3>
            <ul className="lessons-list">
              {section.lessons.map((lesson) => (
                <li key={lesson.id} className="lesson-item">
                  <span className="lesson-icon">
                    {lesson.isFreePreview ? "▶" : "🔒"}
                  </span>
                  <span className="lesson-title">{lesson.title}</span>
                  <span className="lesson-duration">
                    {Math.floor(lesson.durationSeconds / 60)}:
                    {String(lesson.durationSeconds % 60).padStart(2, "0")}
                  </span>
                  {lesson.isFreePreview && (
                    <span className="free-badge">Preview</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Full description */}
      <div className="full-description">
        <h2>Description</h2>
        <p>{course.description}</p>
      </div>
    </div>
  );
}
```

### Web Client — Course Player Page

The learning page shows the course curriculum sidebar with progress and plays lessons:

```tsx
// app/courses/[courseId]/learn/page.tsx

"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db, functions } from "@/firebase/firebase";
import { httpsCallable } from "firebase/functions";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "@/firebase/firebase";
import Hls from "hls.js";
import type { Course, Section, Lesson } from "@/types/course";

export default function CourseLearnPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const [user] = useAuthState(auth);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [course, setCourse] = useState<Course | null>(null);
  const [currentLesson, setCurrentLesson] = useState<Lesson | null>(null);
  const [completedLessons, setCompletedLessons] = useState<string[]>([]);
  const [completionPercent, setCompletionPercent] = useState(0);
  const [videoLoading, setVideoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch course and enrollment data
  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      // Fetch course
      const courseDoc = await getDoc(doc(db, "courses", courseId));
      if (!courseDoc.exists()) return;
      const courseData = { id: courseDoc.id, ...courseDoc.data() } as Course;
      setCourse(courseData);

      // Fetch enrollment for progress
      const { getDocs, query, collection, where } =
        await import("firebase/firestore");
      const enrollmentQuery = query(
        collection(db, "enrollments"),
        where("userId", "==", user.uid),
        where("courseId", "==", courseId),
        where("status", "==", "active"),
      );
      const enrollmentSnap = await getDocs(enrollmentQuery);
      if (!enrollmentSnap.empty) {
        const enrollment = enrollmentSnap.docs[0].data();
        setCompletedLessons(enrollment.progress.completedLessons || []);
        setCompletionPercent(enrollment.progress.completionPercent || 0);

        // Resume from last lesson or start with first lesson
        const lastLessonId = enrollment.progress.lastLessonId;
        const firstLesson = courseData.sections[0]?.lessons[0];

        if (lastLessonId) {
          for (const section of courseData.sections) {
            const found = section.lessons.find((l) => l.id === lastLessonId);
            if (found) {
              setCurrentLesson(found);
              break;
            }
          }
        } else if (firstLesson) {
          setCurrentLesson(firstLesson);
        }
      }
    };

    fetchData();
  }, [courseId, user]);

  // Load video when current lesson changes
  useEffect(() => {
    if (!currentLesson || !videoRef.current) return;

    const loadLesson = async () => {
      setVideoLoading(true);
      setError(null);

      try {
        const getAccess = httpsCallable(functions, "getLessonAccess");
        const result: any = await getAccess({
          courseId,
          lessonId: currentLesson.id,
        });

        const { masterUrl, signedUrls } = result.data;

        if (Hls.isSupported()) {
          const hls = new Hls({
            xhrSetup: (xhr, url) => {
              const matchingKey = Object.keys(signedUrls).find((key) =>
                url.includes(key),
              );
              if (matchingKey) {
                xhr.open("GET", signedUrls[matchingKey], true);
              }
            },
          });

          hls.loadSource(masterUrl);
          hls.attachMedia(videoRef.current!);
          hls.on(Hls.Events.MANIFEST_PARSED, () => setVideoLoading(false));
          hls.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal) setError("Failed to load video.");
          });

          return () => hls.destroy();
        } else if (
          videoRef.current.canPlayType("application/vnd.apple.mpegurl")
        ) {
          videoRef.current.src = masterUrl;
          setVideoLoading(false);
        }
      } catch (err: any) {
        setError(err.message || "Failed to load lesson.");
        setVideoLoading(false);
      }
    };

    loadLesson();
  }, [currentLesson, courseId]);

  const handleMarkComplete = async () => {
    if (!currentLesson) return;

    try {
      const markComplete = httpsCallable(functions, "markLessonComplete");
      const result: any = await markComplete({
        courseId,
        lessonId: currentLesson.id,
      });

      if (
        result.data.status === "completed" ||
        result.data.status === "already_completed"
      ) {
        setCompletedLessons((prev) => [
          ...new Set([...prev, currentLesson.id]),
        ]);
        setCompletionPercent(
          result.data.completionPercent ?? completionPercent,
        );
      }
    } catch (err: any) {
      console.error("Failed to mark complete:", err);
    }
  };

  const handleSelectLesson = (lesson: Lesson) => {
    setCurrentLesson(lesson);
  };

  if (!course) return <div className="loading">Loading course...</div>;

  return (
    <div className="course-learn-layout">
      {/* Video Player Area */}
      <div className="player-area">
        {error && <div className="video-error">{error}</div>}
        {videoLoading && <div className="video-loading">Loading lesson...</div>}
        <video
          ref={videoRef}
          controls
          className="lesson-video"
          style={{ display: videoLoading ? "none" : "block" }}
        />
        {currentLesson && (
          <div className="lesson-actions">
            <h2>{currentLesson.title}</h2>
            <button
              onClick={handleMarkComplete}
              disabled={completedLessons.includes(currentLesson.id)}
              className="mark-complete-btn"
            >
              {completedLessons.includes(currentLesson.id)
                ? "✓ Completed"
                : "Mark as Complete"}
            </button>
          </div>
        )}
      </div>

      {/* Sidebar — Course Curriculum */}
      <div className="curriculum-sidebar">
        <div className="progress-header">
          <h3>{course.title}</h3>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${completionPercent}%` }}
            />
          </div>
          <span className="progress-text">{completionPercent}% complete</span>
        </div>

        {course.sections.map((section) => (
          <div key={section.id} className="sidebar-section">
            <h4>{section.title}</h4>
            <ul>
              {section.lessons.map((lesson) => (
                <li
                  key={lesson.id}
                  className={`sidebar-lesson ${
                    currentLesson?.id === lesson.id ? "active" : ""
                  } ${completedLessons.includes(lesson.id) ? "completed" : ""}`}
                  onClick={() => handleSelectLesson(lesson)}
                >
                  <span className="lesson-status">
                    {completedLessons.includes(lesson.id) ? "✓" : "○"}
                  </span>
                  <span className="lesson-name">{lesson.title}</span>
                  <span className="lesson-time">
                    {Math.floor(lesson.durationSeconds / 60)}:
                    {String(lesson.durationSeconds % 60).padStart(2, "0")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Payment Callback — Course Purchase

Reuse the same callback page pattern from the Netflix section, but call `verifyCoursePurchase` instead:

```tsx
// app/payment/course-callback/page.tsx

"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/firebase/firebase";

export default function CoursePaymentCallbackPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"verifying" | "success" | "failed">(
    "verifying",
  );
  const [message, setMessage] = useState("Verifying your purchase...");

  useEffect(() => {
    const pidx = searchParams.get("pidx");

    if (!pidx) {
      setStatus("failed");
      setMessage("Invalid callback. Missing payment identifier.");
      return;
    }

    const verify = httpsCallable(functions, "verifyCoursePurchase");
    verify({ pidx })
      .then((result: any) => {
        if (
          result.data.status === "success" ||
          result.data.status === "already_enrolled"
        ) {
          setStatus("success");
          setMessage(result.data.message);
          // Redirect to the course learn page after 3 seconds
          setTimeout(() => router.push("/my-courses"), 3000);
        } else {
          setStatus("failed");
          setMessage(result.data.message);
        }
      })
      .catch((error) => {
        setStatus("failed");
        setMessage(error.message || "Purchase verification failed.");
      });
  }, [searchParams, router]);

  return (
    <div className="payment-callback">
      {status === "verifying" && (
        <div className="spinner">
          <div className="loader" />
          <p>{message}</p>
        </div>
      )}
      {status === "success" && (
        <div className="success">
          <h2>✓ Purchase Successful</h2>
          <p>{message}</p>
          <p>Redirecting to your courses...</p>
        </div>
      )}
      {status === "failed" && (
        <div className="error">
          <h2>✗ Purchase Failed</h2>
          <p>{message}</p>
          <button onClick={() => router.push("/courses")}>
            Browse Courses
          </button>
        </div>
      )}
    </div>
  );
}
```

### Refund Handling

Udemy-style platforms typically offer a refund window (e.g., 30 days). Implement a refund function that revokes course access:

```typescript
// functions/src/index.ts (continued)

export const requestRefund = functions.https.onCall(async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Must be logged in.",
    );
  }

  const { enrollmentId } = request.data as { enrollmentId: string };

  const enrollmentDoc = await firestore
    .doc(`enrollments/${enrollmentId}`)
    .get();
  const enrollment = enrollmentDoc.data();

  if (!enrollment || enrollment.userId !== request.auth.uid) {
    throw new functions.https.HttpsError("not-found", "Enrollment not found.");
  }

  if (enrollment.status !== "active") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "This enrollment is not active.",
    );
  }

  // Check refund window (30 days from enrollment)
  const enrolledAt = enrollment.enrolledAt.toDate();
  const daysSinceEnrollment = Math.floor(
    (Date.now() - enrolledAt.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (daysSinceEnrollment > 30) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Refund window has expired (30 days).",
    );
  }

  // Check completion — no refund if more than 30% consumed
  if (enrollment.progress.completionPercent > 30) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Refund not available — more than 30% of the course has been completed.",
    );
  }

  const paymentDoc = await firestore
    .doc(`payments/${enrollment.paymentId}`)
    .get();
  const payment = paymentDoc.data();

  if (!payment) {
    throw new functions.https.HttpsError("not-found", "Payment not found.");
  }

  const batch = firestore.batch();

  // 1. Mark enrollment as refunded
  batch.update(enrollmentDoc.ref, { status: "refunded" });

  // 2. Mark payment as refunded
  batch.update(paymentDoc.ref, {
    status: "refunded",
    refundedAt: FieldValue.serverTimestamp(),
  });

  // 3. Decrement course enrollment count
  batch.update(firestore.doc(`courses/${enrollment.courseId}`), {
    enrollmentCount: FieldValue.increment(-1),
  });

  // 4. Deduct from instructor earnings
  batch.update(firestore.doc(`instructorEarnings/${payment.instructorId}`), {
    totalEarningsNPR: FieldValue.increment(-payment.instructorEarningsNPR),
    pendingPayoutNPR: FieldValue.increment(-payment.instructorEarningsNPR),
    totalSales: FieldValue.increment(-1),
    [`courses.${enrollment.courseId}.sales`]: FieldValue.increment(-1),
    [`courses.${enrollment.courseId}.earningsNPR`]: FieldValue.increment(
      -payment.instructorEarningsNPR,
    ),
    lastUpdated: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  // Note: Actual Khalti refund would require contacting Khalti support
  // or using their refund API if available. The above handles the
  // platform-side accounting.

  return {
    status: "refunded",
    message: "Course refunded. Your access has been revoked.",
  };
});
```

### Purchase Flow — End to End

```
User browses /courses → clicks on a course → /courses/{courseId} →
  → Sees course details, curriculum, price, "Buy with Khalti" button

User clicks "Buy with Khalti" → Frontend calls initiateCoursePurchase() →
  → Cloud Function checks user isn't already enrolled
  → Cloud Function creates payment record with revenue split
  → Cloud Function POSTs to Khalti /epayment/initiate/
  → Returns payment_url to frontend

Frontend redirects to Khalti checkout →
  → User pays via Khalti (wallet, bank, card)
  → Khalti redirects to /payment/course-callback?pidx=...

Callback page calls verifyCoursePurchase({ pidx }) →
  → Cloud Function verifies with Khalti /epayment/lookup/
  → Validates amount matches
  → Creates enrollment record (lifetime access)
  → Increments course enrollment count
  → Updates instructor earnings
  → Returns success

User goes to /courses/{courseId}/learn →
  → Sidebar shows curriculum with progress
  → User clicks a lesson → Frontend calls getLessonAccess()
  → Cloud Function checks enrollment exists and is active
  → Generates signed URLs for that lesson's video
  → HLS player loads with signed URLs

User finishes a lesson → Frontend calls markLessonComplete() →
  → Updates progress in enrollment document
  → Recalculates completion percentage
  → Issues certificate at 100%
```

### Key Differences from Netflix Implementation

1. **Granular access control.** Netflix checks "is user subscribed?" once. Udemy checks "does user own _this specific course_?" for every lesson request.

2. **Free preview lessons.** The `isFreePreview` flag on lessons allows potential buyers to watch selected lessons without purchasing. The `getLessonAccess` function skips enrollment checks for these.

3. **Revenue split.** Every purchase calculates a platform fee (30%) and instructor earnings (70%). The `instructorEarnings` collection tracks per-instructor, per-course revenue for payout reporting.

4. **Progress tracking is core.** Unlike Netflix where progress is "nice to have", Udemy-style platforms require precise progress tracking for completion certificates, resume functionality, and instructor analytics.

5. **Refund policy.** The 30-day / 30% completion refund policy protects both buyers and instructors. Refunds cascade through enrollment, payment, course counters, and instructor earnings.

6. **No expiration.** Netflix subscriptions expire. Course purchases grant **lifetime access** — there's no scheduled cleanup function needed for enrollments.

### Security Considerations

1. **Enrollment-level access control.** Every `getLessonAccess` call queries the enrollments collection. This is the authorization boundary — without an active enrollment, no signed URLs are generated.

2. **Instructor isolation.** Instructors can only modify their own courses. The `createCourse` and `publishCourse` functions verify ownership before allowing changes.

3. **Revenue integrity.** The revenue split is calculated server-side at purchase time and stored in the payment record. Neither the instructor nor the buyer can alter the split.

4. **Refund abuse prevention.** The dual constraint (30-day window + 30% completion cap) prevents users from completing a course and then requesting a refund.

5. **Signed URL scoping.** Each `getLessonAccess` call generates signed URLs for only the requested lesson's video — not the entire course. This limits exposure if URLs are shared.

6. **Khalti amount verification.** Same as Netflix — always verify `total_amount` from Khalti's lookup response against your Firestore record before granting access.
