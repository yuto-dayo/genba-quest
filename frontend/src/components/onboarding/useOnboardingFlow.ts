import { useMemo, useState } from "react";
import type { EmploymentKind } from "../../lib/api";

export type OnboardingDraft = {
    nickname: string;
    fullName: string;
    employmentKind: EmploymentKind;
    jobType: string;
    avatarUrl: string | null;
};

const STEP_COUNT = 5;

function isStepValid(step: number, draft: OnboardingDraft): boolean {
    if (step === 0) {
        const value = draft.nickname.trim();
        return value.length >= 1 && value.length <= 5;
    }

    if (step === 1) {
        const value = draft.fullName.trim();
        return value.length >= 1 && value.length <= 50;
    }

    if (step === 2) {
        return ["employee", "sole_proprietor", "helper"].includes(draft.employmentKind);
    }

    if (step === 3) {
        const value = draft.jobType.trim();
        return value.length >= 1 && value.length <= 40;
    }

    return true;
}

export function useOnboardingFlow(initialDraft: OnboardingDraft) {
    const [step, setStep] = useState(0);
    const [draft, setDraft] = useState<OnboardingDraft>(initialDraft);

    const canProceed = useMemo(() => isStepValid(step, draft), [draft, step]);

    const updateDraft = <K extends keyof OnboardingDraft>(key: K, value: OnboardingDraft[K]) => {
        setDraft((prev) => ({ ...prev, [key]: value }));
    };

    const moveNext = () => {
        setStep((prev) => Math.min(prev + 1, STEP_COUNT - 1));
    };

    const moveBack = () => {
        setStep((prev) => Math.max(prev - 1, 0));
    };

    return {
        step,
        stepCount: STEP_COUNT,
        draft,
        canProceed,
        updateDraft,
        moveNext,
        moveBack,
        isFirstStep: step === 0,
        isLastStep: step === STEP_COUNT - 1,
    };
}
