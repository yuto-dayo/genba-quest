import { afterEach, describe, expect, it, vi } from "vitest";
import {
    ImageCompressionError,
    MAX_INPUT_BYTES,
    TARGET_BYTES,
    compressImageForAvatar,
} from "../imageCompression";

describe("compressImageForAvatar", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("rejects files larger than 10MB", async () => {
        const file = new File([new Uint8Array(MAX_INPUT_BYTES + 1)], "large.jpg", { type: "image/jpeg" });

        await expect(compressImageForAvatar(file)).rejects.toMatchObject({
            code: "TOO_LARGE",
        } satisfies Partial<ImageCompressionError>);
    });

    it("rejects unsupported mime types", async () => {
        const file = new File([new Uint8Array(1024)], "image.heic", { type: "image/heic" });

        await expect(compressImageForAvatar(file)).rejects.toMatchObject({
            code: "MIME_REJECTED",
        } satisfies Partial<ImageCompressionError>);
    });

    it("resizes and center-crops using createImageBitmap with EXIF orientation option", async () => {
        const drawImage = vi.fn();
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
        vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback, _type, quality) => {
            const size = quality === 0.85 ? 120 * 1024 : 90 * 1024;
            callback?.(new Blob([new Uint8Array(size)], { type: "image/jpeg" }));
        });

        const close = vi.fn();
        const createImageBitmapMock = vi.fn().mockResolvedValue({
            width: 4000,
            height: 3000,
            close,
        });
        vi.stubGlobal("createImageBitmap", createImageBitmapMock);

        const file = new File([new Uint8Array(1024 * 100)], "photo.jpg", { type: "image/jpeg" });
        const blob = await compressImageForAvatar(file);

        expect(blob.type).toBe("image/jpeg");
        expect(blob.size).toBeLessThanOrEqual(TARGET_BYTES);
        expect(createImageBitmapMock).toHaveBeenCalledWith(
            file,
            expect.objectContaining({
                resizeWidth: 512,
                resizeHeight: 512,
                imageOrientation: "from-image",
            }),
        );
        expect(drawImage).toHaveBeenCalledWith(expect.anything(), 500, 0, 3000, 3000, 0, 0, 512, 512);
        expect(close).toHaveBeenCalled();
    });

    it("center-crops vertical images correctly", async () => {
        const drawImage = vi.fn();
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
        vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
            callback?.(new Blob([new Uint8Array(80 * 1024)], { type: "image/jpeg" }));
        });

        vi.stubGlobal(
            "createImageBitmap",
            vi.fn().mockResolvedValue({
                width: 1000,
                height: 2000,
                close: vi.fn(),
            }),
        );

        const file = new File([new Uint8Array(1024 * 100)], "vertical.jpg", { type: "image/jpeg" });
        await compressImageForAvatar(file);

        expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 500, 1000, 1000, 0, 0, 512, 512);
    });

    it("falls back to <img> decode when createImageBitmap is unavailable", async () => {
        const drawImage = vi.fn();
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
        vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
            callback?.(new Blob([new Uint8Array(50 * 1024)], { type: "image/jpeg" }));
        });

        vi.stubGlobal("createImageBitmap", undefined);

        const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:avatar");
        const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

        class MockImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            width = 640;
            height = 640;
            naturalWidth = 640;
            naturalHeight = 640;

            set src(_value: string) {
                setTimeout(() => {
                    this.onload?.();
                }, 0);
            }
        }

        vi.stubGlobal("Image", MockImage as unknown as typeof Image);

        const file = new File([new Uint8Array(1024 * 100)], "fallback.png", { type: "image/png" });
        const blob = await compressImageForAvatar(file);

        expect(blob.size).toBeLessThanOrEqual(TARGET_BYTES);
        expect(createObjectURL).toHaveBeenCalled();
        expect(revokeObjectURL).toHaveBeenCalledWith("blob:avatar");
    });
});
