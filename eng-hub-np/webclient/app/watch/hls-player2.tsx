"use client";

import { useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/app/firebase/auth";
import Hls from "hls.js";
import styles from "./hls-player.module.css";

interface HlsPlayerProps {
  videoId: string;
}

interface QualityLevel {
  index: number;
  height: number;
  label: string;
}

interface VideoAccessResponse {
  masterUrl: string;
  signedUrls: Record<string, string>;
  expiresAt: string;
  maxResolution: string;
}

export default function HlsPlayer({ videoId }: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-1); // -1 = Auto

  useEffect(() => {
    if (!videoId || !videoRef.current) return;

    let isCancelled = false;
    setLoading(true);
    setError(null);

    const loadVideo = async () => {
      try {
        const getVideoAccess = httpsCallable<
          { videoId: string },
          VideoAccessResponse
        >(functions, "getVideoAccess");

        const result = await getVideoAccess({ videoId });
        if (isCancelled) return;

        const { masterUrl, signedUrls } = result.data;

        if (Hls.isSupported()) {
          const hls = new Hls({
            startLevel: -1,
            capLevelToPlayerSize: true,
            xhrSetup: (xhr, url) => {
              const cleanUrl = url.split("?")[0];
              const matchingKey = Object.keys(signedUrls).find(
                (key) => cleanUrl.endsWith(key) || cleanUrl.endsWith("/" + key),
              );

              if (matchingKey && signedUrls[matchingKey]) {
                xhr.open("GET", signedUrls[matchingKey], true);
              }
            },
          });

          hls.loadSource(masterUrl);
          hls.attachMedia(videoRef.current!);

          hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
            if (isCancelled) return;
            setLoading(false);
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
            if (!isCancelled) setCurrentLevel(data.level);
          });

          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              console.error("HLS fatal error:", data);
              setError("Failed to load video. Please try again.");
            }
          });

          hlsRef.current = hls;
        } else if (
          videoRef.current?.canPlayType("application/vnd.apple.mpegurl")
        ) {
          // Native Safari fallback
          videoRef.current.src = masterUrl;
          setLoading(false);
        } else {
          setError("HLS playback is not supported on this browser.");
          setLoading(false);
        }
      } catch (err: any) {
        if (!isCancelled) {
          setError(
            err.message || "Access denied. Please check your subscription.",
          );
          setLoading(false);
        }
      }
    };

    loadVideo();

    return () => {
      isCancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [videoId]);

  const handleQualityChange = (levelIndex: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelIndex;
      setCurrentLevel(levelIndex);
    }
  };

  if (error) {
    return (
      <div className={styles.playerContainer}>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className={styles.playerContainer}>
      {loading && <p>Loading secure stream...</p>}
      <video
        ref={videoRef}
        className={styles.video}
        controls
        playsInline
        style={{ display: loading ? "none" : "block" }}
      />

      {!loading && levels.length > 0 && (
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
