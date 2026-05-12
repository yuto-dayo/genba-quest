import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMemo, useState } from "react";
import {
    completeOnboarding,
    type MyProfileRecord,
} from "../../lib/api";
import {
    ImageCompressionError,
    compressImageForAvatar,
} from "../../lib/imageCompression";
import { supabase } from "../../lib/supabase";
import { StepShell } from "./StepShell";
import { useOnboardingFlow } from "./useOnboardingFlow";
import { AvatarStep } from "./steps/AvatarStep";
import { EmploymentKindStep } from "./steps/EmploymentKindStep";
import { FullNameStep } from "./steps/FullNameStep";
import { JobTypeStep } from "./steps/JobTypeStep";
import { NicknameStep } from "./steps/NicknameStep";
import styles from "./OnboardingWizard.module.css";

type OnboardingWizardProps = {
    initialProfile: MyProfileRecord;
    onComplete: () => Promise<void> | void;
};

function getAvatarErrorMessage(error: unknown): string {
    if (error instanceof ImageCompressionError) {
        if (error.code === "TOO_LARGE") {
            return "画像が大きすぎます。10MB以下の画像を選んでください。";
        }
        if (error.code === "MIME_REJECTED") {
            return "JPEG / PNG / WebP の画像を選んでください。";
        }
        return "画像の読み込みに失敗しました。別の画像でお試しください。";
    }

    if (error instanceof Error) {
        return error.message;
    }

    return "画像のアップロードに失敗しました。";
}

export function OnboardingWizard({ initialProfile, onComplete }: OnboardingWizardProps) {
    const shouldReduceMotion = useReducedMotion();
    const [direction, setDirection] = useState<1 | -1>(1);
    const [avatarBusy, setAvatarBusy] = useState(false);
    const [avatarError, setAvatarError] = useState<string | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [submitBusy, setSubmitBusy] = useState(false);
    const [showConfetti, setShowConfetti] = useState(false);

    const flow = useOnboardingFlow({
        nickname: initialProfile.nickname ?? "",
        fullName: initialProfile.full_name ?? "",
        employmentKind: initialProfile.employment_kind ?? "employee",
        jobType: initialProfile.job_type ?? "",
        avatarUrl: initialProfile.avatar_url ?? null,
    });

    const stepConfigs = useMemo(
        () => [
            {
                title: "現場でなんて呼ばれてる？",
                description: "画面ではいつもこの名前で表示します",
            },
            {
                title: "本名を教えて",
                description: "請求書や税書類で使う正式名称です",
            },
            {
                title: "どんな立場で働いてる？",
                description: "税金や請求の扱いに使います",
            },
            {
                title: "どの仕事がメイン？",
                description: "あとでいつでも変更できます",
            },
            {
                title: "アバター画像を設定する？",
                description: "任意です。あとで設定しても大丈夫です",
            },
        ],
        [],
    );

    const handleBack = () => {
        if (flow.isFirstStep) {
            return;
        }
        setDirection(-1);
        flow.moveBack();
    };

    const handleAvatarSelect = async (file: File) => {
        if (submitBusy) {
            return;
        }

        if (file.type === "image/heic" || file.type === "image/heif") {
            setAvatarError("HEIC画像は未対応です。写真アプリでJPEGに変換して選んでください。");
            return;
        }

        setAvatarBusy(true);
        setAvatarError(null);

        try {
            const compressed = await compressImageForAvatar(file);
            const objectPath = `${initialProfile.id}/avatar.jpg`;
            const { error: uploadError } = await supabase.storage
                .from("avatars")
                .upload(objectPath, compressed, {
                    upsert: true,
                    contentType: "image/jpeg",
                });

            if (uploadError) {
                throw uploadError;
            }

            const {
                data: { publicUrl },
            } = supabase.storage.from("avatars").getPublicUrl(objectPath);

            flow.updateDraft("avatarUrl", publicUrl);
        } catch (error) {
            setAvatarError(getAvatarErrorMessage(error));
        } finally {
            setAvatarBusy(false);
        }
    };

    const handleFinalize = async () => {
        if (submitBusy || avatarBusy || !flow.canProceed) {
            return;
        }

        setSubmitBusy(true);
        setSubmitError(null);

        try {
            await completeOnboarding({
                nickname: flow.draft.nickname.trim(),
                full_name: flow.draft.fullName.trim(),
                employment_kind: flow.draft.employmentKind,
                job_type: flow.draft.jobType.trim(),
                avatar_url: flow.draft.avatarUrl,
            });

            if (!shouldReduceMotion) {
                setShowConfetti(true);
                setTimeout(() => {
                    setShowConfetti(false);
                }, 1200);
            }

            await onComplete();
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : "プロフィール保存に失敗しました。");
        } finally {
            setSubmitBusy(false);
        }
    };

    const handleNext = () => {
        if (flow.isLastStep) {
            void handleFinalize();
            return;
        }

        setDirection(1);
        flow.moveNext();
    };

    const isNextDisabled = submitBusy || avatarBusy || !flow.canProceed;

    return (
        <section className={styles.screen} aria-label="プロフィール初期設定">
            {showConfetti ? (
                <div className={styles.confettiLayer} aria-hidden>
                    {Array.from({ length: 18 }).map((_, index) => (
                        <span
                            key={index}
                            className={styles.confetti}
                            style={{
                                left: `${(index * 97) % 100}%`,
                                animationDelay: `${(index % 6) * 0.05}s`,
                            }}
                        />
                    ))}
                </div>
            ) : null}

            <AnimatePresence mode="wait" initial={false}>
                <motion.div
                    key={flow.step}
                    className={styles.panel}
                    initial={
                        shouldReduceMotion
                            ? { opacity: 0 }
                            : { x: direction > 0 ? "16%" : "-16%", opacity: 0 }
                    }
                    animate={{ x: 0, opacity: 1 }}
                    exit={
                        shouldReduceMotion
                            ? { opacity: 0 }
                            : { x: direction > 0 ? "-12%" : "12%", opacity: 0 }
                    }
                    transition={{ duration: shouldReduceMotion ? 0.16 : 0.28, ease: [0.2, 0, 0, 1] }}
                >
                    <StepShell
                        step={flow.step}
                        totalSteps={flow.stepCount}
                        title={stepConfigs[flow.step].title}
                        description={stepConfigs[flow.step].description}
                        onNext={handleNext}
                        nextDisabled={isNextDisabled}
                        nextLabel={flow.isLastStep ? (submitBusy ? "保存中..." : "はじめる ✨") : "次へ"}
                        onBack={flow.isFirstStep ? undefined : handleBack}
                        secondaryAction={
                            flow.isLastStep ? (
                                <button
                                    type="button"
                                    className={styles.skipButton}
                                    onClick={() => {
                                        flow.updateDraft("avatarUrl", null);
                                        void handleFinalize();
                                    }}
                                    disabled={submitBusy || avatarBusy}
                                >
                                    あとで設定
                                </button>
                            ) : null
                        }
                    >
                        {flow.step === 0 ? (
                            <NicknameStep
                                value={flow.draft.nickname}
                                onChange={(value) => flow.updateDraft("nickname", value)}
                            />
                        ) : null}

                        {flow.step === 1 ? (
                            <FullNameStep
                                value={flow.draft.fullName}
                                onChange={(value) => flow.updateDraft("fullName", value)}
                            />
                        ) : null}

                        {flow.step === 2 ? (
                            <EmploymentKindStep
                                value={flow.draft.employmentKind}
                                onChange={(value) => flow.updateDraft("employmentKind", value)}
                            />
                        ) : null}

                        {flow.step === 3 ? (
                            <JobTypeStep
                                value={flow.draft.jobType}
                                onChange={(value) => flow.updateDraft("jobType", value)}
                            />
                        ) : null}

                        {flow.step === 4 ? (
                            <AvatarStep
                                avatarUrl={flow.draft.avatarUrl}
                                busy={avatarBusy}
                                error={avatarError}
                                onSelectFile={(file) => {
                                    void handleAvatarSelect(file);
                                }}
                            />
                        ) : null}

                        {submitError ? <p className={styles.errorText}>{submitError}</p> : null}
                    </StepShell>
                </motion.div>
            </AnimatePresence>
        </section>
    );
}
