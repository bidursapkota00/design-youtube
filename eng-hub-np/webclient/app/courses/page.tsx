// app/courses/page.tsx

"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { db } from "@/app/firebase/firebase";
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
