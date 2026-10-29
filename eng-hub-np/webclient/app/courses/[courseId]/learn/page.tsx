"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase/firebase";
import { httpsCallable } from "firebase/functions";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth, functions } from "@/app/firebase/auth";
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
        } else {
          const video = videoRef.current;

          if (video?.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = masterUrl;
            setVideoLoading(false);
          } else {
            setError("HLS playback is not supported in this browser.");
            setVideoLoading(false);
          }
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

      {/* Sidebar. Course Curriculum */}
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
