// components/SubscriptionGuard.tsx

"use client";

import { useEffect, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase/firebase";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "@/app/firebase/auth";

interface Props {
  children: ReactNode;
}

export default function SubscriptionGuard({ children }: Props) {
  const [user, authLoading] = useAuthState(auth);
  const [hasAccess, setHasAccess] = useState(false);
  const [checking, setChecking] = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      router.push("/login");
      return;
    }

    const checkSubscription = async () => {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      const data = userDoc.data();

      if (
        data?.subscription?.status === "active" &&
        data?.subscription?.endDate?.toDate() > new Date()
      ) {
        setHasAccess(true);
      } else {
        router.push("/subscribe");
      }
      setChecking(false);
    };

    checkSubscription();
  }, [user, authLoading, router]);

  if (authLoading || checking) {
    return <div className="loading">Checking access...</div>;
  }

  return hasAccess ? <>{children}</> : null;
}
