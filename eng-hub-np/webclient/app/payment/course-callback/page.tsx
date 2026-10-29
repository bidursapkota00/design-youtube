// app/payment/course-callback/page.tsx

"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/app/firebase/auth";

export default function CoursePaymentCallbackPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"verifying" | "success" | "failed">(
    "verifying",
  );
  const [message, setMessage] = useState("Verifying your purchase...");

  useEffect(() => {
    const pidx = searchParams.get("pidx");

    if (!pidx) {
      setStatus("failed");
      setMessage("Invalid callback. Missing payment identifier.");
      return;
    }

    const verify = httpsCallable(functions, "verifyCoursePurchase");
    verify({ pidx })
      .then((result: any) => {
        if (
          result.data.status === "success" ||
          result.data.status === "already_enrolled"
        ) {
          setStatus("success");
          setMessage(result.data.message);
          // Redirect to the course learn page after 3 seconds
          setTimeout(() => router.push("/my-courses"), 3000);
        } else {
          setStatus("failed");
          setMessage(result.data.message);
        }
      })
      .catch((error) => {
        setStatus("failed");
        setMessage(error.message || "Purchase verification failed.");
      });
  }, [searchParams, router]);

  return (
    <div className="payment-callback">
      {status === "verifying" && (
        <div className="spinner">
          <div className="loader" />
          <p>{message}</p>
        </div>
      )}
      {status === "success" && (
        <div className="success">
          <h2>✓ Purchase Successful</h2>
          <p>{message}</p>
          <p>Redirecting to your courses...</p>
        </div>
      )}
      {status === "failed" && (
        <div className="error">
          <h2>✗ Purchase Failed</h2>
          <p>{message}</p>
          <button onClick={() => router.push("/courses")}>
            Browse Courses
          </button>
        </div>
      )}
    </div>
  );
}
