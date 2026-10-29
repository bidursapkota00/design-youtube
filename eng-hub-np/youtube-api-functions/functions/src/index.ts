import {onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as functions from "firebase-functions/v1";
import {initializeApp} from "firebase-admin/app";
import {getFirestore, FieldValue, Timestamp} from "firebase-admin/firestore";
import {Storage} from "@google-cloud/storage";
import {
  initiateKhaltiPayment,
  verifyKhaltiPayment,
} from "./services/KhaltiService.js";
import {SUBSCRIPTION_PLANS} from "./types/subscription.js";
import {Course, PLATFORM_FEE_PERCENT} from "./types/course.js";

initializeApp();

const firestore = getFirestore();
const storage = new Storage();

const processedBucket = storage.bucket("codeyalaya-yt-processed-videos");

export const requestRefund = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Must be logged in.",
    );
  }

  const {enrollmentId} = data as { enrollmentId: string };

  const enrollmentDoc = await firestore
    .doc(`enrollments/${enrollmentId}`)
    .get();
  const enrollment = enrollmentDoc.data();

  if (!enrollment || enrollment.userId !== context.auth.uid) {
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

  // Check completion, no refund if more than 30% consumed
  if (enrollment.progress.completionPercent > 30) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Refund not available, more than 30% of the course has been completed.",
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
  batch.update(enrollmentDoc.ref, {status: "refunded"});

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

export const markLessonComplete = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Must be logged in.",
      );
    }

    const {courseId, lessonId} = data as {
      courseId: string;
      lessonId: string;
    };

    // Find enrollment
    const enrollmentQuery = await firestore
      .collection("enrollments")
      .where("userId", "==", context.auth.uid)
      .where("courseId", "==", courseId)
      .where("status", "==", "active")
      .limit(1)
      .get();

    if (enrollmentQuery.empty) {
      throw new functions.https.HttpsError(
        "not-found",
        "Enrollment not found.",
      );
    }

    const enrollmentDoc = enrollmentQuery.docs[0];
    const enrollment = enrollmentDoc.data();

    // Skip if already completed
    if (enrollment.progress.completedLessons.includes(lessonId)) {
      return {status: "already_completed"};
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
      await enrollmentDoc.ref.update({certificateIssued: true});
      // Optionally trigger certificate generation here
    }

    return {
      status: "completed",
      completionPercent,
      certificateIssued: completionPercent === 100,
    };
  },
);

export const getLessonAccess = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Must be logged in to watch.",
    );
  }

  const {courseId, lessonId} = data as {
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
      .where("userId", "==", context.auth.uid)
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

  const masterPlaylistFile = processedBucket.file(`${videoId}/master.m3u8`);
  const [exists] = await masterPlaylistFile.exists();

  if (!exists) {
    throw new functions.https.HttpsError(
      "not-found",
      "Video not yet processed.",
    );
  }

  // Signed URLs expire in 6 hours, enough for long lectures
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

export const verifyCoursePurchase = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Must be logged in.",
      );
    }

    const {pidx} = data as { pidx: string };
    if (!pidx) {
      throw new functions.https.HttpsError("invalid-argument", "Missing pidx.");
    }

    // Find payment record
    const paymentQuery = await firestore
      .collection("payments")
      .where("khaltiPidx", "==", pidx)
      .where("userId", "==", context.auth.uid)
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

    // Idempotent, already processed
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
        message:
          `Payment ${verification.status.toLowerCase()}. ` +
          "Please try again.",
      };
    }

    // Verify amount
    if (verification.total_amount !== paymentData.amountPaisa) {
      await paymentDoc.ref.update({status: "failed"});
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Payment amount mismatch.",
      );
    }

    // Payment verified, create enrollment and update records
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
      userId: context.auth.uid,
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
        totalEarningsNPR: FieldValue.increment(
          paymentData.instructorEarningsNPR,
        ),
        pendingPayoutNPR: FieldValue.increment(
          paymentData.instructorEarningsNPR,
        ),
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
  },
);

export const initiateCoursePurchase = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Must be logged in to purchase.",
      );
    }

    const {courseId, phone} = data as {
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
      .where("userId", "==", context.auth.uid)
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
    const purchaseOrderId =
      "COURSE_" + `${courseId}_${context.auth.uid}_${Date.now()}`;
    const paymentRef = firestore.collection("payments").doc();

    await paymentRef.set({
      userId: context.auth.uid,
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
        customerName: context.auth.token.name || "User",
        customerEmail: context.auth.token.email || "",
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
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Payment initiation failed.";
      logger.error("Course payment initiation failed:", error);
      await paymentRef.update({status: "failed"});
      throw new functions.https.HttpsError("internal", message);
    }
  },
);

export const publishCourse = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Must be logged in.",
    );
  }

  const {courseId} = data as { courseId: string };

  const courseDoc = await firestore.doc(`courses/${courseId}`).get();
  const courseData = courseDoc.data();

  if (!courseData) {
    throw new functions.https.HttpsError("not-found", "Course not found.");
  }

  // Only the instructor or an admin can publish
  const userDoc = await firestore.doc(`users/${context.auth.uid}`).get();
  const userData = userDoc.data();
  const isOwner = courseData.instructorId === context.auth.uid;
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

  return {status: "published"};
});

export const createCourse = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Must be logged in.",
    );
  }

  // Verify user is an approved instructor
  const userDoc = await firestore.doc(`users/${context.auth.uid}`).get();
  const userData = userDoc.data();
  if (userData?.role !== "instructor") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only approved instructors can create courses.",
    );
  }

  const courseData = data as Omit<
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
    instructorId: context.auth.uid,
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

  return {courseId: courseRef.id, slug};
});

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
        batch.update(historyDoc.ref, {status: "expired"});
      }

      count++;
    }

    if (count > 0) {
      await batch.commit();
      console.log(`Expired ${count} subscriptions.`);
    }
  });

export const getVideoAccess = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Must be logged in to watch.",
    );
  }

  const {videoId} = data as { videoId: string };

  // Check subscription status
  const userDoc = await firestore.doc(`users/${context.auth.uid}`).get();
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

  // Signed URLs expire in 4 hours, enough for a movie
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

/**
 * Get allowed resolutions up to the maximum resolution.
 * @param {string} maxResolution Max resolution allowed.
 * @return {string[]} List of allowed resolutions.
 */
function getAllowedResolutions(maxResolution: string): string[] {
  const all = ["360p", "480p", "720p", "1080p", "4K"];
  const maxIndex = all.indexOf(maxResolution);
  if (maxIndex === -1) return all;
  return all.slice(0, maxIndex + 1);
}

export const initiateSubscription = functions.https.onCall(
  async (data, context) => {
    // Ensure user is authenticated
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Must be logged in to subscribe.",
      );
    }

    const {planId, phone} = data as {
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
    const userDoc = await firestore.doc(`users/${context.auth.uid}`).get();
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
    const purchaseOrderId = `SUB_${context.auth.uid}_${Date.now()}`;
    const paymentRef = firestore.collection("payments").doc();

    await paymentRef.set({
      userId: context.auth.uid,
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
        purchaseOrderName: `${plan.name} Plan, ${plan.durationDays} Days`,
      },
    });

    // Initiate Khalti payment
    try {
      const khaltiResponse = await initiateKhaltiPayment({
        amount: plan.pricePaisa,
        purchaseOrderId,
        purchaseOrderName: `${plan.name} Plan, ${plan.durationDays} Days`,
        customerName: context.auth.token.name || "User",
        customerEmail: context.auth.token.email || "",
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
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Payment initiation failed.";
      logger.error("Payment initiation failed:", error);
      // Mark payment as failed
      await paymentRef.update({status: "failed"});
      throw new functions.https.HttpsError("internal", message);
    }
  },
);

export const verifySubscriptionPayment = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Must be logged in.",
      );
    }

    const {pidx} = data as { pidx: string };
    if (!pidx) {
      throw new functions.https.HttpsError("invalid-argument", "Missing pidx.");
    }

    // Find the payment record by pidx
    const paymentQuery = await firestore
      .collection("payments")
      .where("khaltiPidx", "==", pidx)
      .where("userId", "==", context.auth.uid)
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

    // Already completed, return early (idempotent)
    if (paymentData.status === "completed") {
      return {status: "already_active", message: "Subscription is active."};
    }

    // Verify with Khalti (server-to-server, never trust frontend params)
    const verification = await verifyKhaltiPayment(pidx);

    if (verification.status !== "Completed") {
      await paymentDoc.ref.update({
        status: verification.status === "User canceled" ? "failed" : "expired",
      });

      return {
        status: "failed",
        message:
          `Payment ${verification.status.toLowerCase()}. ` +
          "Please try again.",
      };
    }

    // Verify amount matches (prevent tampering)
    if (verification.total_amount !== paymentData.amountPaisa) {
      await paymentDoc.ref.update({status: "failed"});
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Payment amount mismatch.",
      );
    }

    // Payment verified, activate subscription
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
    batch.update(firestore.doc(`users/${context.auth.uid}`), {
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
      userId: context.auth.uid,
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
    return {success: true};
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    logger.error("Error writing to Firestore:", {message: errorMessage});
    return {success: false, error: errorMessage};
  }
});

export const generateUploadUrl = onCall(
  {maxInstances: 1},
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

    return {url, fileName};
  },
);

export const getVideos = onCall({maxInstances: 1}, async () => {
  const snapshot = await firestore
    .collection(videoCollectionId)
    .limit(10)
    .get();
  return snapshot.docs.map((doc) => doc.data());
});
