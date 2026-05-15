// ================================
//   FIREBASE CONNECTION
// ================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc, updateDoc, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// Your Firebase config
const firebaseConfig = {
    apiKey: "AIzaSyC4U6MWTPKDQZ_oICtSLdfnFP3a-HFILb4",
    authDomain: "daily-news-a8c64.firebaseapp.com",
    projectId: "daily-news-a8c64",
    storageBucket: "daily-news-a8c64.firebasestorage.app",
    messagingSenderId: "75335342698",
    appId: "1:75335342698:web:3e65f3d773eca7730b4813"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

export { db, storage, collection, addDoc, getDocs, deleteDoc, doc, updateDoc, orderBy, query, ref, uploadBytes, getDownloadURL };