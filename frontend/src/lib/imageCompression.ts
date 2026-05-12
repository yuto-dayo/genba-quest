export const ACCEPTED_AVATAR_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const TARGET_DIMENSION = 512;
export const TARGET_BYTES = 100 * 1024;

type ImageCompressionErrorCode =
    | "TOO_LARGE"
    | "MIME_REJECTED"
    | "DECODE_FAILED"
    | "ENCODE_FAILED";

export class ImageCompressionError extends Error {
    code: ImageCompressionErrorCode;

    constructor(code: ImageCompressionErrorCode) {
        super(code);
        this.name = "ImageCompressionError";
        this.code = code;
    }
}

type DecodedImage = {
    source: CanvasImageSource;
    width: number;
    height: number;
    close: () => void;
};

async function decodeViaBitmap(file: File): Promise<DecodedImage> {
    if (typeof createImageBitmap !== "function") {
        throw new Error("createImageBitmap is not available");
    }

    const options: ImageBitmapOptions = {
        resizeWidth: TARGET_DIMENSION,
        resizeHeight: TARGET_DIMENSION,
        resizeQuality: "high",
        imageOrientation: "from-image",
    };

    const bitmap = await createImageBitmap(file, options);
    return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
    };
}

async function decodeViaImg(file: File): Promise<DecodedImage> {
    const objectUrl = URL.createObjectURL(file);

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const width = img.naturalWidth || img.width;
            const height = img.naturalHeight || img.height;
            resolve({
                source: img,
                width,
                height,
                close: () => {
                    URL.revokeObjectURL(objectUrl);
                },
            });
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("decode via img failed"));
        };
        img.src = objectUrl;
    });
}

function computeCenterCrop(width: number, height: number) {
    const size = Math.min(width, height);
    const sx = Math.floor((width - size) / 2);
    const sy = Math.floor((height - size) / 2);
    return { sx, sy, size };
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (!blob) {
                    reject(new ImageCompressionError("ENCODE_FAILED"));
                    return;
                }
                resolve(blob);
            },
            "image/jpeg",
            quality,
        );
    });
}

export async function compressImageForAvatar(file: File): Promise<Blob> {
    if (file.size > MAX_INPUT_BYTES) {
        throw new ImageCompressionError("TOO_LARGE");
    }

    if (!ACCEPTED_AVATAR_MIME.includes(file.type as (typeof ACCEPTED_AVATAR_MIME)[number])) {
        throw new ImageCompressionError("MIME_REJECTED");
    }

    let decoded: DecodedImage;
    try {
        decoded = await decodeViaBitmap(file);
    } catch {
        try {
            decoded = await decodeViaImg(file);
        } catch {
            throw new ImageCompressionError("DECODE_FAILED");
        }
    }

    const canvas = document.createElement("canvas");
    canvas.width = TARGET_DIMENSION;
    canvas.height = TARGET_DIMENSION;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
        decoded.close();
        throw new ImageCompressionError("ENCODE_FAILED");
    }

    const crop = computeCenterCrop(decoded.width, decoded.height);
    ctx.drawImage(
        decoded.source,
        crop.sx,
        crop.sy,
        crop.size,
        crop.size,
        0,
        0,
        TARGET_DIMENSION,
        TARGET_DIMENSION,
    );
    decoded.close();

    for (const quality of [0.85, 0.75, 0.65]) {
        const blob = await canvasToBlob(canvas, quality);
        if (blob.size <= TARGET_BYTES || quality === 0.65) {
            return blob;
        }
    }

    throw new ImageCompressionError("ENCODE_FAILED");
}
