// app/subscribe/page.tsx

"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions, auth } from "@/app/firebase/auth";
import { useAuthState } from "react-firebase-hooks/auth";

const plans = [
  {
    id: "basic",
    name: "Basic",
    price: "रू 299",
    period: "/month",
    resolution: "720p",
    streams: 1,
    features: ["SD & HD streaming", "Watch on 1 device", "Cancel anytime"],
  },
  {
    id: "standard",
    name: "Standard",
    price: "रू 599",
    period: "/month",
    resolution: "1080p",
    streams: 2,
    features: [
      "Full HD streaming",
      "Watch on 2 devices",
      "Download for offline",
      "Cancel anytime",
    ],
    popular: true,
  },
  {
    id: "premium",
    name: "Premium",
    price: "रू 999",
    period: "/month",
    resolution: "4K + HDR",
    streams: 4,
    features: [
      "4K + HDR streaming",
      "Watch on 4 devices",
      "Download for offline",
      "Spatial Audio",
      "Cancel anytime",
    ],
  },
];

export default function SubscribePage() {
  const [user] = useAuthState(auth);
  const [loading, setLoading] = useState<string | null>(null);

  const handleSubscribe = async (planId: string) => {
    if (!user) {
      alert("Please sign in first.");
      return;
    }

    setLoading(planId);

    try {
      const phone = prompt(
        "Enter your phone number for Khalti (e.g. 9800000000):"
      );
      if (!phone) {
        setLoading(null);
        return;
      }

      const initiateSubscription = httpsCallable(
        functions,
        "initiateSubscription",
      );
      const result: any = await initiateSubscription({
        planId,
        phone,
      });

      // Redirect to Khalti checkout
      window.location.href = result.data.paymentUrl;
    } catch (error: any) {
      alert(error.message || "Failed to initiate payment.");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="subscribe-page">
      <h1>Choose Your Plan</h1>
      <p>Watch unlimited movies and shows. Cancel anytime.</p>

      <div className="plans-grid">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`plan-card ${plan.popular ? "popular" : ""}`}
          >
            {plan.popular && <span className="badge">Most Popular</span>}
            <h2>{plan.name}</h2>
            <div className="price">
              <span className="amount">{plan.price}</span>
              <span className="period">{plan.period}</span>
            </div>
            <p className="resolution">Up to {plan.resolution}</p>
            <p className="streams">{plan.streams} concurrent stream(s)</p>
            <ul>
              {plan.features.map((f) => (
                <li key={f}>✓ {f}</li>
              ))}
            </ul>
            <button
              onClick={() => handleSubscribe(plan.id)}
              disabled={loading === plan.id}
            >
              {loading === plan.id ? "Processing..." : "Pay with Khalti"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
