import { httpsCallable } from "firebase/functions";
import { functions } from "./auth";

const generateUploadUrl = httpsCallable<
  { fileExtension: string },
  UploadUrlResponse
>(functions, "generateUploadUrl");
const getVideosFunction = httpsCallable(functions, "getVideos");

export interface Video {
  id?: string;
  uid?: string;
  filename?: string;
  status?: "processing" | "processed";
  title?: string;
  description?: string;
}

interface UploadUrlResponse {
  url: string;
  fileName: string;
}

export async function uploadVideo(file: File) {
  const response = await generateUploadUrl({
    fileExtension: file.name.split(".").pop()!,
  });

  // Upload the file via the signed URL
  await fetch(response?.data?.url, {
    method: "PUT",
    body: file,
    headers: {
      "Content-Type": file.type,
    },
  });

  return;
}

export async function getVideos() {
  const response = await getVideosFunction();
  return response.data as Video[];
}
