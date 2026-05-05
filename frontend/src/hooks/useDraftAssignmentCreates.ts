import { useCallback, useState } from 'react';
import type { DraftAssignmentCreate } from '../lib/dayScheduleBoard';

type DraftAssignmentCreateInput = Omit<DraftAssignmentCreate, 'id'>;

interface AddDraftOptions {
    occupiedWorkerIdsForDate: string[];
}

export function useDraftAssignmentCreates() {
    const [drafts, setDrafts] = useState<DraftAssignmentCreate[]>([]);
    const [nextSequence, setNextSequence] = useState(1);

    const addDraft = useCallback(
        (
            input: DraftAssignmentCreateInput,
            { occupiedWorkerIdsForDate }: AddDraftOptions
        ): { ok: boolean; message: string } => {
            if (occupiedWorkerIdsForDate.includes(input.worker_id)) {
                return {
                    ok: false,
                    message: 'この日はすでに別の現場に入っています。',
                };
            }

            if (
                drafts.some(
                    (draft) =>
                        draft.date === input.date && draft.worker_id === input.worker_id
                )
            ) {
                return {
                    ok: false,
                    message: 'この日の追加案に入っています。',
                };
            }

            setDrafts((current) => [
                ...current,
                {
                    ...input,
                    id: `assignment-create-draft-${nextSequence}`,
                },
            ]);
            setNextSequence((current) => current + 1);

            return {
                ok: true,
                message: '追加案に入れました。',
            };
        },
        [drafts, nextSequence]
    );

    const removeDraft = useCallback((draftId: string) => {
        setDrafts((current) => current.filter((draft) => draft.id !== draftId));
    }, []);

    const clearDrafts = useCallback(() => {
        setDrafts([]);
    }, []);

    return {
        drafts,
        addDraft,
        removeDraft,
        clearDrafts,
    };
}
