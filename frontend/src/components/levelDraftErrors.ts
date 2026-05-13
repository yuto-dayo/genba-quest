export function mapLevelDraftSubmitErrorMessage(message: string): string {
    if (message.includes("PATH_V33_DRAFT_DEADLINE_PASSED")) {
        return "入力期限（現場完了から7日）を過ぎました。PATH 画面から修正申請してください。";
    }
    return message;
}

export function mapLevelDraftReviseErrorMessage(message: string): string {
    if (message.includes("PATH_V33_DRAFT_LOCKED")) {
        return "この申告は確定済みのため修正できません。月締め後の変更は管理者に相談してください。";
    }
    if (message.includes("PATH_V33_REVISION_REASON_REQUIRED")) {
        return "修正理由を入力してください。";
    }
    if (message.includes("PATH_V33_REVISION_REASON_TOO_LONG")) {
        return "修正理由は 500 文字以内で入力してください。";
    }
    if (message.includes("PATH_V33_DRAFT_OWNER_MISMATCH")) {
        return "他のメンバーの申告は修正できません。";
    }
    return message;
}
