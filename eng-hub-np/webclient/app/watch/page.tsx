"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import HlsPlayer from "./hls-player2";
import SubscriptionGuard from "@/components/SubscriptionGuard";

function VideoPlayer() {
  const searchParams = useSearchParams();
  const v = searchParams.get("v");
  const videoId = v ? v.split("/")[0] : null;

  return (
    <>
      <h1>Watch Page</h1>
      {videoId ? <HlsPlayer videoId={videoId} /> : <p>No video selected</p>}
    </>
  );
}

function Loading() {
  return <p>Loading video player...</p>;
}

export default function Watch() {
  return (
    <SubscriptionGuard>
      <div>
        <Suspense fallback={<Loading />}>
          <VideoPlayer />
        </Suspense>
      </div>
    </SubscriptionGuard>
  );
}
