// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCF9VGHw09_aEeieWuCbZlJmjvBE5m7m6M",
  authDomain: "eng-hub-np.firebaseapp.com",
  projectId: "eng-hub-np",
  storageBucket: "eng-hub-np.firebasestorage.app",
  messagingSenderId: "437990835446",
  appId: "1:437990835446:web:896688bbb6fe55b74f98d7",
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
