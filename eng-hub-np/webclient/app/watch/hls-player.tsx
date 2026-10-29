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
