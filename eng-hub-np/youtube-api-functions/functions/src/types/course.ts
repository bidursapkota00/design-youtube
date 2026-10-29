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
