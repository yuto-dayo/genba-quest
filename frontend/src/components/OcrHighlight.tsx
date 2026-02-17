import { useRef, useState, useEffect, useCallback } from "react";
import type { OcrBlock, OcrFields, OcrFieldValue } from "../lib/api";
import styles from "./OcrHighlight.module.css";

interface OcrHighlightProps {
    imageSrc: string;
    ocrBlocks: OcrBlock[];
    ocrFields: OcrFields | null;
    highlightedField: string | null;
}

const FIELD_COLORS: Record<string, string> = {
    vendor_name: "#4da6ff",
    date: "#9d4edd",
    subtotal: "#ffc107",
    tax_amount: "#ff9800",
    total_amount: "#4caf50",
};

interface ImageBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export function OcrHighlight({
    imageSrc,
    ocrBlocks,
    ocrFields,
    highlightedField,
}: OcrHighlightProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const [imageBounds, setImageBounds] = useState<ImageBounds>({ x: 0, y: 0, width: 0, height: 0 });

    // object-fit: contain による実際の画像表示位置を計算
    const calculateImageBounds = useCallback(() => {
        const container = containerRef.current;
        const img = imageRef.current;
        if (!container || !img || !img.naturalWidth || !img.naturalHeight) return;

        const containerWidth = container.offsetWidth;
        const containerHeight = container.offsetHeight;
        const imgRatio = img.naturalWidth / img.naturalHeight;
        const containerRatio = containerWidth / containerHeight;

        let renderWidth: number;
        let renderHeight: number;

        if (imgRatio > containerRatio) {
            // 画像が横長: 横幅に合わせる
            renderWidth = containerWidth;
            renderHeight = containerWidth / imgRatio;
        } else {
            // 画像が縦長: 高さに合わせる
            renderHeight = containerHeight;
            renderWidth = containerHeight * imgRatio;
        }

        const x = (containerWidth - renderWidth) / 2;
        const y = (containerHeight - renderHeight) / 2;

        setImageBounds({ x, y, width: renderWidth, height: renderHeight });
    }, []);

    useEffect(() => {
        calculateImageBounds();
        window.addEventListener("resize", calculateImageBounds);
        return () => window.removeEventListener("resize", calculateImageBounds);
    }, [calculateImageBounds]);

    // ハイライトするブロックのインデックスを取得
    const getHighlightedBlockIndices = (): Set<number> => {
        if (!highlightedField || !ocrFields) return new Set();

        const field = ocrFields[highlightedField] as OcrFieldValue | undefined;
        if (!field?.bbox_refs) return new Set();

        return new Set(field.bbox_refs);
    };

    const highlightedIndices = getHighlightedBlockIndices();

    // 相対座標を実際のピクセル位置に変換（画像のオフセットを考慮）
    const scaleToContainer = (bbox: OcrBlock["bbox"]) => {
        const x = imageBounds.x + bbox.x0 * imageBounds.width;
        const y = imageBounds.y + bbox.y0 * imageBounds.height;
        const width = (bbox.x1 - bbox.x0) * imageBounds.width;
        const height = (bbox.y1 - bbox.y0) * imageBounds.height;

        return { x, y, width, height };
    };

    return (
        <div ref={containerRef} className={styles.container}>
            <img
                ref={imageRef}
                src={imageSrc}
                alt="Receipt"
                className={styles.image}
                onLoad={calculateImageBounds}
            />

            <svg className={styles.overlay}>
                {ocrBlocks.map((block, index) => {
                    const isHighlighted = highlightedIndices.has(index);
                    const { x, y, width, height } = scaleToContainer(block.bbox);

                    // ハイライトされているフィールドの色を取得
                    let strokeColor = "rgba(77, 166, 255, 0.3)";
                    let fillColor = "transparent";

                    if (isHighlighted && highlightedField) {
                        strokeColor = FIELD_COLORS[highlightedField] || "#4da6ff";
                        fillColor = `${strokeColor}20`;
                    }

                    return (
                        <g key={index}>
                            <rect
                                x={x}
                                y={y}
                                width={width}
                                height={height}
                                fill={fillColor}
                                stroke={strokeColor}
                                strokeWidth={isHighlighted ? 2 : 1}
                                className={`${styles.bbox} ${isHighlighted ? styles.highlighted : ""}`}
                            />
                            {isHighlighted && (
                                <text
                                    x={x}
                                    y={y - 4}
                                    fill={strokeColor}
                                    fontSize="10"
                                    className={styles.label}
                                >
                                    {block.text}
                                </text>
                            )}
                        </g>
                    );
                })}
            </svg>

            {/* フィールド凡例 */}
            {ocrFields && Object.keys(ocrFields).length > 0 && (
                <div className={styles.legend}>
                    {Object.entries(FIELD_COLORS).map(([field, color]) => {
                        const fieldData = ocrFields[field] as OcrFieldValue | undefined;
                        if (!fieldData) return null;

                        return (
                            <div
                                key={field}
                                className={`${styles.legendItem} ${highlightedField === field ? styles.active : ""
                                    }`}
                            >
                                <span
                                    className={styles.legendColor}
                                    style={{ background: color }}
                                />
                                <span className={styles.legendLabel}>
                                    {getFieldLabel(field)}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function getFieldLabel(field: string): string {
    const labels: Record<string, string> = {
        vendor_name: "取引先",
        date: "日付",
        subtotal: "小計",
        tax_amount: "税額",
        total_amount: "合計",
    };
    return labels[field] || field;
}
