"use client";

import SignIn from "./sign-in";
import { onAuthStateChangedHelper } from "@/app/firebase/auth";
import { useEffect, useState } from "react";
import { User } from "firebase/auth";
import Image from "next/image";
import Link from "next/link";
import styles from "./navbar.module.css";
import Upload from "./upload";

export default function Navbar() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChangedHelper((user) => {
      setUser(user);
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, []);

  return (
    <nav className={styles.nav}>
      <Link href="/">
        <Image
          width={90}
          height={20}
          src="/youtube-logo.png"
          alt="YouTube Logo"
        />
      </Link>
      {user && <Upload />}
      <SignIn user={user} />
    </nav>
  );
}
