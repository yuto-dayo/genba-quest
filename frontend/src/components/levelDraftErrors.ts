export function mapLevelDraftSubmitErrorMessage(message: string): string {
    if (message.includes("PATH_V33_DRAFT_DEADLINE_PASSED")) {
        return "入力期限（現場完了から7日）を過ぎました。PATH 画面から修正申請してください。";
    }
    return message;
}
