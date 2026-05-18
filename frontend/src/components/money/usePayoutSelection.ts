import { useState } from "react";

interface PayoutSelectionState {
    initialMemberId: string | null;
    selectedMemberId: string | null;
    viewMode: "single" | "all";
}

interface UsePayoutSelectionState {
    selectedMemberId: string | null;
    viewMode: "single" | "all";
    onSelectMember: (memberId: string | "all") => void;
}

function createSelectionState(initialMemberId: string | null): PayoutSelectionState {
    return {
        initialMemberId,
        selectedMemberId: initialMemberId,
        viewMode: initialMemberId ? "single" : "all",
    };
}

export function usePayoutSelection(initialMemberId: string | null): UsePayoutSelectionState {
    const [state, setState] = useState<PayoutSelectionState>(() => createSelectionState(initialMemberId));

    if (state.initialMemberId !== initialMemberId) {
        const nextState = createSelectionState(initialMemberId);
        setState(nextState);
        return {
            selectedMemberId: nextState.selectedMemberId,
            viewMode: nextState.viewMode,
            onSelectMember: (memberId: string | "all") => {
                setState(memberId === "all"
                    ? { ...nextState, selectedMemberId: null, viewMode: "all" }
                    : { ...nextState, selectedMemberId: memberId, viewMode: "single" });
            },
        };
    }

    const onSelectMember = (memberId: string | "all") => {
        setState((current) => (
            memberId === "all"
                ? { ...current, selectedMemberId: null, viewMode: "all" }
                : { ...current, selectedMemberId: memberId, viewMode: "single" }
        ));
    };

    return {
        selectedMemberId: state.selectedMemberId,
        viewMode: state.viewMode,
        onSelectMember,
    };
}
