import fs from "fs";

/**
 * Validates actual binary signatures (magic bytes) and structural integrity
 * from a file on disk. Does not trust client-provided extension or MIME header.
 *
 * Supported formats:
 * - JPEG: FF D8 FF ... trailer FF D9
 * - PNG:  89 50 4E 47 0D 0A 1A 0A ... IHDR chunk ... IEND trailer
 * - WebP: 52 49 46 46 (RIFF) at offset 0, and 57 45 42 50 (WEBP) at offset 8 ... VP8/VP8L/VP8X chunk
 * - PDF:  25 50 44 46 2D (%PDF-) at offset 0 ... %%EOF trailer
 *
 * HEIC/HEIF signatures:
 * - ftypbox with major brands 'heic', 'heix', 'hevc', 'mif1', 'msf1'
 *
 * @param {string} filePath - Absolute path to uploaded file on disk
 * @returns {Promise<{ isValid: boolean, detectedType: string|null, isHeic: boolean, error?: string }>}
 */
export async function validateFileSignature(filePath) {
  let fd = null;
  try {
    const stats = await fs.promises.stat(filePath);
    const fileSize = stats.size;

    if (fileSize < 4) {
      return {
        isValid: false,
        detectedType: null,
        isHeic: false,
        error: "ফাইলটি ফাঁকা বা ত্রুটিযুক্ত (File is empty or too small).",
      };
    }

    const header = Buffer.alloc(Math.min(64, fileSize));
    fd = await fs.promises.open(filePath, "r");
    await fd.read(header, 0, header.length, 0);

    // 1. Check for HEIC / HEIF brand in ISO Base Media File Format (ftyp)
    if (header.length >= 12) {
      const ftyp = header.toString("ascii", 4, 8);
      if (ftyp === "ftyp") {
        const brand = header.toString("ascii", 8, 12).toLowerCase();
        if (["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(brand)) {
          return {
            isValid: false,
            detectedType: "heic",
            isHeic: true,
            error: "HEIC/HEIF ফরম্যাট বর্তমানে সমর্থিত নয়। অনুগ্রহ করে ফাইলটিকে JPEG অথবা PNG ফরম্যাটে রূপান্তর করে আপলোড করুন (HEIC/HEIF is not supported directly. Please convert to JPG/PNG before upload).",
          };
        }
      }
    }

    // 2. JPEG: Starts with FF D8 FF
    if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
      // Structural check: Read the last 128 bytes to confirm JPEG EOI marker (FF D9) is present
      const tailLen = Math.min(128, fileSize);
      const tailBuf = Buffer.alloc(tailLen);
      await fd.read(tailBuf, 0, tailLen, fileSize - tailLen);
      
      let hasEoi = false;
      for (let i = 0; i < tailLen - 1; i++) {
        if (tailBuf[i] === 0xff && tailBuf[i + 1] === 0xd9) {
          hasEoi = true;
          break;
        }
      }

      if (!hasEoi) {
        return {
          isValid: false,
          detectedType: null,
          isHeic: false,
          error: "জেপিজি ফাইলটি অসম্পূর্ণ বা ত্রুটিযুক্ত (Malformed or truncated JPEG file; missing EOI marker).",
        };
      }

      return {
        isValid: true,
        detectedType: "image/jpeg",
        isHeic: false,
      };
    }

    // 3. PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      header[0] === 0x89 &&
      header[1] === 0x50 &&
      header[2] === 0x4e &&
      header[3] === 0x47 &&
      header[4] === 0x0d &&
      header[5] === 0x0a &&
      header[6] === 0x1a &&
      header[7] === 0x0a
    ) {
      // Structural check: Check first chunk is IHDR (offset 12..15)
      const firstChunkType = header.toString("ascii", 12, 16);
      if (firstChunkType !== "IHDR") {
        return {
          isValid: false,
          detectedType: null,
          isHeic: false,
          error: "পিএনজি ফাইলটি ত্রুটিযুক্ত (Malformed PNG; missing IHDR chunk).",
        };
      }

      // Check for IEND chunk in the tail
      const tailLen = Math.min(128, fileSize);
      const tailBuf = Buffer.alloc(tailLen);
      await fd.read(tailBuf, 0, tailLen, fileSize - tailLen);
      if (!tailBuf.includes("IEND")) {
        return {
          isValid: false,
          detectedType: null,
          isHeic: false,
          error: "পিএনজি ফাইলটি অসম্পূর্ণ (Truncated PNG; missing IEND chunk).",
        };
      }

      return {
        isValid: true,
        detectedType: "image/png",
        isHeic: false,
      };
    }

    // 4. WebP: RIFF (bytes 0..3) ... WEBP (bytes 8..11) ... chunk (VP8, VP8L, VP8X at 12..15)
    if (header.length >= 16) {
      const riff = header.toString("ascii", 0, 4);
      const webp = header.toString("ascii", 8, 12);
      const chunk = header.toString("ascii", 12, 16);

      if (riff === "RIFF" && webp === "WEBP") {
        if (!["VP8 ", "VP8L", "VP8X"].includes(chunk)) {
          return {
            isValid: false,
            detectedType: null,
            isHeic: false,
            error: "ওয়েবপি ফাইলটি ত্রুটিযুক্ত (Malformed WebP; missing valid VP8/VP8L/VP8X chunk).",
          };
        }
        return {
          isValid: true,
          detectedType: "image/webp",
          isHeic: false,
        };
      }
    }

    // 5. PDF: %PDF- (bytes 0..4)
    if (header.length >= 5) {
      const pdfHeader = header.toString("ascii", 0, 5);
      if (pdfHeader === "%PDF-") {
        // Structural check: Confirm %%EOF exists within the last 1024 bytes
        const tailLen = Math.min(1024, fileSize);
        const tailBuf = Buffer.alloc(tailLen);
        await fd.read(tailBuf, 0, tailLen, fileSize - tailLen);
        const tailStr = tailBuf.toString("ascii");

        if (!tailStr.includes("%%EOF")) {
          return {
            isValid: false,
            detectedType: null,
            isHeic: false,
            error: "পিডিএফ ফাইলটি অসম্পূর্ণ বা ত্রুটিযুক্ত (Truncated or corrupted PDF; missing %%EOF marker).",
          };
        }

        return {
          isValid: true,
          detectedType: "application/pdf",
          isHeic: false,
        };
      }
    }

    return {
      isValid: false,
      detectedType: null,
      isHeic: false,
      error: "ফাইলের বাইনারি সিগনেচার বৈধ নয়। শুধুমাত্র আসল JPG, PNG, WebP অথবা PDF ফাইল গ্রহণযোগ্য (Invalid binary signature. Spoofed or unsupported file).",
    };
  } catch (err) {
    return {
      isValid: false,
      detectedType: null,
      isHeic: false,
      error: `ফাইল যাচাইকরণে ত্রুটি: ${err.message}`,
    };
  } finally {
    if (fd) {
      await fd.close().catch(() => {});
    }
  }
}
