"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase/firebase";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/app/firebase/auth";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "@/app/firebase/auth";
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
