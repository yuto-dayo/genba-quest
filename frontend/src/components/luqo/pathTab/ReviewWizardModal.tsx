import {
  Bell,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import type { Member, PathMonthlyEvaluationAiReview } from "../../../lib/api";
import { displayMemberName } from "./helpers";

interface ReviewWizardModalProps {
  styles: Record<string, string>;
  memberMap: Map<string, Member>;
  selectedReviewQueueEntry: PathMonthlyEvaluationAiReview | null;
  selectedReviewItems: Array<{ title: string; detail: string }>;
  activeReviewItem: { title: string; detail: string } | null;
  reviewWizardIndex: number;
  setReviewWizardIndex: React.Dispatch<React.SetStateAction<number>>;
  reviewAnswers: Record<string, "confirmed" | "needs_followup" | "adjust">;
  setReviewAnswers: React.Dispatch<
    React.SetStateAction<
      Record<string, "confirmed" | "needs_followup" | "adjust">
    >
  >;
  submittingFinalize: boolean;
  onFinalizeSubmit: (memberId: string) => void;
  onClose: () => void;
}

export function ReviewWizardModal({
  styles,
  memberMap,
  selectedReviewQueueEntry,
  selectedReviewItems,
  activeReviewItem,
  reviewWizardIndex,
  setReviewWizardIndex,
  reviewAnswers,
  setReviewAnswers,
  submittingFinalize,
  onFinalizeSubmit,
  onClose,
}: ReviewWizardModalProps) {
  return (
    <div
      className={styles.reviewWizardOverlay}
      onClick={onClose}
      role="presentation"
    >
      <div
        className={styles.reviewWizardModal}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="path-review-wizard-title"
      >
        <div className={styles.reviewWizardHeader}>
          <div>
            <p className={styles.reviewWizardEyebrow}>Review Inbox</p>
            <h3 id="path-review-wizard-title">
              {selectedReviewQueueEntry
                ? `${displayMemberName(selectedReviewQueueEntry.member_id, memberMap)} の確認`
                : "レビュー確認"}
            </h3>
            <p className={styles.reviewWizardSubtitle}>
              必要な確認だけを順番に見て、そのまま評価確定の申請まで進めます。
            </p>
          </div>
          <button
            type="button"
            className={styles.reviewWizardClose}
            onClick={onClose}
            aria-label="閉じる"
          >
            <X size={18} />
          </button>
        </div>

        {selectedReviewQueueEntry ? (
          <>
            <div className={styles.reviewWizardMetaRow}>
              <span className={styles.metaBadge}>
                <Bell size={12} />
                {selectedReviewItems.length} 件
              </span>
              <span className={styles.reviewWizardProgress}>
                {selectedReviewItems.length > 0
                  ? `${reviewWizardIndex + 1} / ${selectedReviewItems.length}`
                  : "確認項目なし"}
              </span>
            </div>

            {activeReviewItem ? (
              <div className={styles.reviewWizardCard}>
                <span className={styles.infoLabel}>
                  {activeReviewItem.title}
                </span>
                <strong>{activeReviewItem.detail}</strong>
                <div className={styles.reviewWizardChoiceGrid}>
                  {(
                    [
                      ["confirmed", "問題なし"],
                      ["needs_followup", "あとで確認"],
                      ["adjust", "修正する"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`${styles.reviewWizardChoice} ${
                        reviewAnswers[String(reviewWizardIndex)] === value
                          ? styles.reviewWizardChoiceActive
                          : ""
                      }`}
                      onClick={() =>
                        setReviewAnswers((current) => ({
                          ...current,
                          [String(reviewWizardIndex)]: value,
                        }))
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className={styles.workflowCallout}>
                <div>
                  <span className={styles.infoLabel}>確認状況</span>
                  <strong>追加レビューはありません</strong>
                </div>
                <p>このまま評価確定の申請を作れます。</p>
              </div>
            )}

            <div className={styles.reviewWizardFooter}>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() =>
                  setReviewWizardIndex((current) => Math.max(current - 1, 0))
                }
                disabled={reviewWizardIndex === 0}
              >
                <ChevronLeft size={14} />
                前へ
              </button>
              <div className={styles.reviewWizardFooterActions}>
                {reviewWizardIndex < selectedReviewItems.length - 1 ? (
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() =>
                      setReviewWizardIndex((current) =>
                        Math.min(
                          current + 1,
                          selectedReviewItems.length - 1,
                        ),
                      )
                    }
                    disabled={!reviewAnswers[String(reviewWizardIndex)]}
                  >
                    次へ
                    <ChevronRight size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() =>
                      onFinalizeSubmit(selectedReviewQueueEntry.member_id)
                    }
                    disabled={
                      submittingFinalize ||
                      (selectedReviewItems.length > 0 &&
                        !reviewAnswers[String(reviewWizardIndex)])
                    }
                  >
                    <CheckCircle2 size={14} />
                    {submittingFinalize ? "申請中..." : "評価確定を申請"}
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className={styles.emptyCompareState}>
            今はベルで確認するレビューはありません。
          </div>
        )}
      </div>
    </div>
  );
}
