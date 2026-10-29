"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/app/firebase/auth";

export default function PaymentCallbackPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"verifying" | "success" | "failed">(
    "verifying",
  );
  const [message, setMessage] = useState("Verifying your payment...");

  useEffect(() => {
    const pidx = searchParams.get("pidx");
    const paymentStatus = searchParams.get("status");

    if (!pidx) {
      setStatus("failed");
      setMessage("Invalid payment callback. Missing payment identifier.");
      return;
    }

    // Even if Khalti says "Completed" in the URL, always verify server-side
    const verifyPayment = httpsCallable(functions, "verifySubscriptionPayment");
    verifyPayment({ pidx })
      .then((result: any) => {
        if (
          result.data.status === "success" ||
          result.data.status === "already_active"
        ) {
          setStatus("success");
          setMessage(result.data.message);
          // Redirect to home after 3 seconds
          setTimeout(() => router.push("/"), 3000);
        } else {
          setStatus("failed");
          setMessage(result.data.message);
        }
      })
      .catch((error) => {
        setStatus("failed");
        setMessage(error.message || "Payment verification failed.");
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
          <h2>✓ Payment Successful</h2>
          <p>{message}</p>
          <p>Redirecting to home...</p>
        </div>
      )}
      {status === "failed" && (
        <div className="error">
          <h2>✗ Payment Failed</h2>
          <p>{message}</p>
          <button onClick={() => router.push("/subscribe")}>Try Again</button>
        </div>
      )}
    </div>
  );
}
