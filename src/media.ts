import { existsSync, readFileSync } from "fs";
import { extname } from "path";
import { loadAllCredentials } from "./auth/credentials.ts";

const IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/**
 * Read an image file and return base64 data + mime type.
 * Returns null if file missing or unsupported format.
 */
export function readImageAsBase64(
  filePath: string
): { data: string; mimeType: string } | null {
  if (!existsSync(filePath)) return null;

  const ext = extname(filePath).toLowerCase();
  const mimeType = IMAGE_MIME[ext];
  if (!mimeType) return null;

  try {
    const data = readFileSync(filePath).toString("base64");
    return { data, mimeType };
  } catch (err) {
    console.error(`[media] Failed to read image: ${filePath}`, err);
    return null;
  }
}

/**
 * Transcribe an audio file using OpenAI's Whisper API.
 * Returns transcription text, or null if no API key or on failure.
 */
export async function transcribeAudio(
  filePath: string
): Promise<string | null> {
  const store = loadAllCredentials();
  const whisperCred = store["whisper"];

  if (!whisperCred || whisperCred.method !== "api_key") {
    console.log(
      "[whisper] No API key configured, skipping. Run: nakedclaw setup"
    );
    return null;
  }

  if (!existsSync(filePath)) {
    console.error(`[whisper] File not found: ${filePath}`);
    return null;
  }

  console.log("[whisper] Transcribing...");

  try {
    const file = Bun.file(filePath);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("model", "whisper-1");

    const res = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${whisperCred.apiKey}`,
        },
        body: formData,
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[whisper] API error (${res.status}): ${errText}`);
      return null;
    }

    const data = (await res.json()) as { text: string };
    console.log(`[whisper] Done (${data.text.length} chars)`);
    return data.text;
  } catch (err) {
    console.error("[whisper] Transcription failed:", err);
    return null;
  }
}
