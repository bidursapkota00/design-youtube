# Design YouTube — Full Stack & System Design Guide

![Bidur Sapkota](https://www.bidursapkota.com.np/images/gravatar.webp "Bidur Sapkota - Developer")&nbsp;[Bidur Sapkota](https://www.bidursapkota.com.np/)

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
npm install --save-dev typescript ts-node @types/node @types/express
```

`express` is the web framework. `typescript` and `ts-node` enable writing and running TypeScript directly. `@types/node` and `@types/express` provide type definitions for Node.js and Express.

### Create `.gitignore`

```text
node_modules
```

### Create `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES6",
    "module": "CommonJS",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`target` sets the JavaScript version to compile to. `module` specifies the module system. `rootDir` and `outDir` separate source and compiled files. `strict` enables all strict type-checking options. `esModuleInterop` allows default imports from CommonJS modules like Express.

### Update `package.json` Scripts

```json
{
  "name": "video-processing-service",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "start": "ts-node src/index.ts",
    "build": "tsc",
    "serve": "node dist/index.js"
  },
  "author": "",
  "license": "ISC",
  "description": "",
  "devDependencies": {
    "@types/express": "^5.0.1",
    "@types/node": "^22.15.2",
    "ts-node": "^10.9.2",
    "typescript": "^5.8.3"
  },
  "dependencies": {
    "express": "^5.1.0"
  }
}
```

`start` runs TypeScript directly for development. `build` compiles TypeScript to JavaScript. `serve` runs the compiled output for production.

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
FROM node:18 AS builder

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
FROM node:18

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

Stage 1 (`builder`) installs all dependencies including dev dependencies, compiles TypeScript to JavaScript, and produces the `dist/` folder. Stage 2 starts fresh with `node:18`, installs FFmpeg and only production dependencies, then copies the compiled output from the builder stage. This keeps the final image small by excluding TypeScript, type definitions, and build tools.

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
gcloud auth login                        # Authenticate
gcloud config set project <PROJECT_ID>   # Set active project
gcloud config get-value project          # Verify project
```

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

  if (!isVideoNew(videoId)) {
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
