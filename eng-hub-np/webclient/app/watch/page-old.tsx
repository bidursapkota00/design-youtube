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
