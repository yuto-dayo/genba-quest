import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
    Building2,
    Loader2,
    MapPin,
    ReceiptText,
    Save,
    Trash2,
    Upload,
    X,
} from "lucide-react";
import {
    createClient,
    deleteClient,
    scanBusinessCard,
    updateClient,
    type Client,
    type CreateClientRequest,
} from "../lib/api";
import {
    areAddressesEqual,
    composeAddress,
    formatPostalCode,
    getClientBillingAddress,
    getClientPrimaryAddress,
    PREFECTURES,
    type StructuredAddressFields,
} from "../lib/clientAddress";
import { getErrorMessage } from "../lib/error";
import styles from "./ClientSettingsModal.module.css";

interface ClientSettingsModalProps {
    client?: Client | null;
    initialClient?: Partial<CreateClientRequest> | null;
    onClose: () => void;
    onSaved: (client: Client) => void | Promise<void>;
    onDeleted: (clientId: string) => void | Promise<void>;
}

type ClientFormState = CreateClientRequest;

const emptyClientForm: ClientFormState = {
    name: "",
    department: "",
    contact_person: "",
    email: "",
    phone: "",
    postal_code: "",
    prefecture: "",
    city: "",
    address_line1: "",
    address_line2: "",
    billing_name: "",
    billing_postal_code: "",
    billing_prefecture: "",
    billing_city: "",
    billing_address_line1: "",
    billing_address_line2: "",
    payment_terms: "",
    invoice_notes_default: "",
};

function toClientForm(client: Client | null, initialClient?: Partial<CreateClientRequest> | null): ClientFormState {
    if (!client) {
        return {
            ...emptyClientForm,
            ...initialClient,
            billing_name: initialClient?.billing_name || initialClient?.name || "",
        };
    }

    const primaryAddress = getClientPrimaryAddress(client);
    const billingAddress = getClientBillingAddress(client);

    return {
        name: client.name || "",
        department: client.department || "",
        contact_person: client.contact_person || "",
        email: client.email || "",
        phone: client.phone || "",
        postal_code: primaryAddress.postal_code,
        prefecture: primaryAddress.prefecture,
        city: primaryAddress.city,
        address_line1: primaryAddress.address_line1,
        address_line2: primaryAddress.address_line2,
        billing_name: client.billing_name || client.name || "",
        billing_postal_code: billingAddress.postal_code,
        billing_prefecture: billingAddress.prefecture,
        billing_city: billingAddress.city,
        billing_address_line1: billingAddress.address_line1,
        billing_address_line2: billingAddress.address_line2,
        payment_terms: client.payment_terms || "",
        invoice_notes_default: client.invoice_notes_default || "",
    };
}

function getPrimaryAddress(form: ClientFormState): StructuredAddressFields {
    return {
        postal_code: form.postal_code || "",
        prefecture: form.prefecture || "",
        city: form.city || "",
        address_line1: form.address_line1 || "",
        address_line2: form.address_line2 || "",
    };
}

function getBillingAddress(form: ClientFormState): StructuredAddressFields {
    return {
        postal_code: form.billing_postal_code || "",
        prefecture: form.billing_prefecture || "",
        city: form.billing_city || "",
        address_line1: form.billing_address_line1 || "",
        address_line2: form.billing_address_line2 || "",
    };
}

function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("ファイルの読み込みに失敗しました"));
        reader.onload = () => {
            const result = reader.result;
            if (typeof result !== "string") {
                reject(new Error("ファイルの読み込みに失敗しました"));
                return;
            }

            const [, base64 = ""] = result.split(",");
            resolve(base64);
        };
        reader.readAsDataURL(file);
    });
}

export function ClientSettingsModal({
    client,
    initialClient,
    onClose,
    onSaved,
    onDeleted,
}: ClientSettingsModalProps) {
    const isEdit = Boolean(client);
    const [form, setForm] = useState<ClientFormState>(() => toClientForm(client || null, initialClient));
    const [billingSameAsPrimary, setBillingSameAsPrimary] = useState(true);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [scanSummary, setScanSummary] = useState<string | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteReason, setDeleteReason] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const nextForm = toClientForm(client || null, initialClient);
        const primaryAddress = getPrimaryAddress(nextForm);
        const billingAddress = getBillingAddress(nextForm);

        setForm(nextForm);
        setBillingSameAsPrimary(
            composeAddress(billingAddress) === "" || areAddressesEqual(primaryAddress, billingAddress)
        );
        setScanSummary(null);
        setShowDeleteConfirm(false);
        setDeleteReason("");
        setError(null);
        setDeleteError(null);
    }, [client, initialClient]);

    useEffect(() => {
        if (!billingSameAsPrimary) {
            return;
        }

        setForm((prev) => ({
            ...prev,
            ...(() => {
                const primaryAddress = getPrimaryAddress(prev);
                return {
                    billing_postal_code: primaryAddress.postal_code,
                    billing_prefecture: primaryAddress.prefecture,
                    billing_city: primaryAddress.city,
                    billing_address_line1: primaryAddress.address_line1,
                    billing_address_line2: primaryAddress.address_line2,
                };
            })(),
        }));
    }, [
        billingSameAsPrimary,
        form.postal_code,
        form.prefecture,
        form.city,
        form.address_line1,
        form.address_line2,
    ]);

    const primaryAddress = getPrimaryAddress(form);
    const billingAddress = billingSameAsPrimary ? primaryAddress : getBillingAddress(form);
    const primaryAddressPreview = composeAddress(primaryAddress);
    const billingAddressPreview = composeAddress(billingAddress);

    const handleField = (field: keyof ClientFormState, value: string) => {
        const normalizedValue = field.includes("postal_code") ? formatPostalCode(value) : value;
        setForm((prev) => ({ ...prev, [field]: normalizedValue }));
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();

        if (!form.name?.trim()) {
            setError("取引先名を入力してください");
            return;
        }

        try {
            setSaving(true);
            setError(null);

            const finalBillingAddress = billingSameAsPrimary ? primaryAddress : billingAddress;
            const payload: CreateClientRequest = {
                name: form.name.trim(),
                department: form.department?.trim() || undefined,
                contact_person: form.contact_person?.trim() || undefined,
                email: form.email?.trim() || undefined,
                phone: form.phone?.trim() || undefined,
                postal_code: primaryAddress.postal_code || undefined,
                prefecture: primaryAddress.prefecture || undefined,
                city: primaryAddress.city || undefined,
                address_line1: primaryAddress.address_line1 || undefined,
                address_line2: primaryAddress.address_line2 || undefined,
                address: primaryAddressPreview || undefined,
                billing_name: form.billing_name?.trim() || form.name.trim(),
                billing_postal_code: finalBillingAddress.postal_code || undefined,
                billing_prefecture: finalBillingAddress.prefecture || undefined,
                billing_city: finalBillingAddress.city || undefined,
                billing_address_line1: finalBillingAddress.address_line1 || undefined,
                billing_address_line2: finalBillingAddress.address_line2 || undefined,
                billing_address: composeAddress(finalBillingAddress) || undefined,
                payment_terms: form.payment_terms?.trim() || undefined,
                invoice_notes_default: form.invoice_notes_default?.trim() || undefined,
            };

            const saved = isEdit && client
                ? await updateClient(client.id, payload)
                : await createClient(payload);

            await Promise.resolve(onSaved(saved));
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!client) {
            return;
        }

        const normalizedReason = deleteReason.trim();
        if (!normalizedReason) {
            setDeleteError("削除理由を入力してください");
            return;
        }

        try {
            setDeleting(true);
            setDeleteError(null);
            await deleteClient(client.id, normalizedReason);
            await Promise.resolve(onDeleted(client.id));
        } catch (err: unknown) {
            setDeleteError(getErrorMessage(err));
        } finally {
            setDeleting(false);
        }
    };

    const openDeleteConfirm = () => {
        setDeleteReason("");
        setDeleteError(null);
        setShowDeleteConfirm(true);
    };

    const closeDeleteConfirm = () => {
        if (deleting) {
            return;
        }

        setShowDeleteConfirm(false);
        setDeleteReason("");
        setDeleteError(null);
    };

    const handleScanBusinessCard = async (file: File) => {
        if (!file.type.startsWith("image/")) {
            setError("名刺は画像ファイルでアップロードしてください");
            return;
        }

        try {
            setScanning(true);
            setError(null);

            const base64 = await fileToBase64(file);
            const extracted = await scanBusinessCard({
                file_base64: base64,
                mime_type: file.type,
            });

            setForm((prev) => ({
                ...prev,
                name: extracted.name || prev.name,
                department: extracted.department || prev.department,
                contact_person: extracted.contact_person || prev.contact_person,
                email: extracted.email || prev.email,
                phone: extracted.phone || prev.phone,
                postal_code: extracted.postal_code || prev.postal_code,
                prefecture: extracted.prefecture || prev.prefecture,
                city: extracted.city || prev.city,
                address_line1: extracted.address_line1 || prev.address_line1,
                address_line2: extracted.address_line2 || prev.address_line2,
                billing_name: prev.billing_name || extracted.name || prev.name,
            }));
            setScanSummary(extracted.raw_text || "名刺の内容をフォームに反映しました");
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setScanning(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    };

    return (
        <>
            <motion.div
                className={styles.overlay}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
            >
                <motion.div
                    className={styles.modal}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="client-settings-title"
                    initial={{ opacity: 0, y: 24, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 16, scale: 0.98 }}
                    onClick={(event) => event.stopPropagation()}
                >
                    <header className={styles.header}>
                        <div>
                            <p className={styles.eyebrow}>取引先マスタ</p>
                            <h2 id="client-settings-title" className={styles.title}>
                                {isEdit ? "取引先を編集" : "新規取引先を追加"}
                            </h2>
                        </div>
                        <button className={styles.closeButton} onClick={onClose} aria-label="閉じる">
                            <X size={22} />
                        </button>
                    </header>

                    <form className={styles.form} onSubmit={handleSubmit}>
                        {error && <div className={styles.error}>{error}</div>}

                        <section className={styles.hero}>
                            <div className={styles.heroCopy}>
                                <span className={styles.heroChip}>
                                    {isEdit ? "編集モード" : "新規登録"}
                                </span>
                                <h3>名刺から取り込んで、請求先情報までその場で整える</h3>
                                <p>
                                    会社名、担当者、住所を分割して保持します。請求先住所が同一ならコピーだけで済みます。
                                </p>
                                <div className={styles.heroActions}>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        className={styles.fileInput}
                                        onChange={(event) => {
                                            const file = event.target.files?.[0];
                                            if (file) {
                                                void handleScanBusinessCard(file);
                                            }
                                        }}
                                    />
                                    <button
                                        type="button"
                                        className={styles.secondaryButton}
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={saving || deleting || scanning}
                                    >
                                        {scanning ? <Loader2 size={16} className={styles.spinner} /> : <Upload size={16} />}
                                        名刺を読み取る
                                    </button>
                                    <span className={styles.heroHint}>
                                        会社名 / 担当者 / 郵便番号 / 住所を自動で補完
                                    </span>
                                </div>
                                {scanSummary && <p className={styles.scanSummary}>{scanSummary}</p>}
                            </div>

                            <div className={styles.previewCard}>
                                <div className={styles.previewRow}>
                                    <Building2 size={16} />
                                    <span>{form.name || "取引先名を入力してください"}</span>
                                </div>
                                <div className={styles.previewRow}>
                                    <ReceiptText size={16} />
                                    <span>{form.billing_name || "請求書の宛名未設定"}</span>
                                </div>
                                <div className={styles.previewRow}>
                                    <MapPin size={16} />
                                    <span>{billingAddressPreview || primaryAddressPreview || "住所未設定"}</span>
                                </div>
                            </div>
                        </section>

                        <section className={styles.section}>
                            <div className={styles.sectionHeader}>
                                <h3 className={styles.sectionTitle}>基本情報</h3>
                                <p className={styles.sectionDescription}>名刺の表面で判断しやすい順に並べています。</p>
                            </div>
                            <div className={styles.grid}>
                                <label className={styles.field}>
                                    <span>取引先名 *</span>
                                    <input
                                        className={styles.input}
                                        value={form.name}
                                        onChange={(event) => handleField("name", event.target.value)}
                                        placeholder="株式会社フソー"
                                        autoComplete="organization"
                                        required
                                    />
                                </label>

                                <label className={styles.field}>
                                    <span>部署</span>
                                    <input
                                        className={styles.input}
                                        value={form.department}
                                        onChange={(event) => handleField("department", event.target.value)}
                                        placeholder="工事部"
                                        autoComplete="organization-title"
                                    />
                                </label>

                                <label className={styles.field}>
                                    <span>担当者</span>
                                    <input
                                        className={styles.input}
                                        value={form.contact_person}
                                        onChange={(event) => handleField("contact_person", event.target.value)}
                                        placeholder="山田 太郎"
                                        autoComplete="name"
                                    />
                                </label>

                                <label className={styles.field}>
                                    <span>請求書の宛名</span>
                                    <input
                                        className={styles.input}
                                        value={form.billing_name}
                                        onChange={(event) => handleField("billing_name", event.target.value)}
                                        placeholder="株式会社フソー 御中"
                                        autoComplete="organization"
                                    />
                                </label>
                            </div>
                        </section>

                        <section className={styles.section}>
                            <div className={styles.sectionHeader}>
                                <h3 className={styles.sectionTitle}>連絡先</h3>
                                <p className={styles.sectionDescription}>名刺OCRで拾いやすい項目をそのまま確認できます。</p>
                            </div>
                            <div className={styles.grid}>
                                <label className={styles.field}>
                                    <span>メール</span>
                                    <input
                                        className={styles.input}
                                        value={form.email}
                                        onChange={(event) => handleField("email", event.target.value)}
                                        placeholder="contact@example.com"
                                        autoComplete="email"
                                        inputMode="email"
                                    />
                                </label>

                                <label className={styles.field}>
                                    <span>電話番号</span>
                                    <input
                                        className={styles.input}
                                        value={form.phone}
                                        onChange={(event) => handleField("phone", event.target.value)}
                                        placeholder="03-1234-5678"
                                        autoComplete="tel"
                                        inputMode="tel"
                                    />
                                </label>
                            </div>
                        </section>

                        <section className={styles.section}>
                            <div className={styles.sectionHeader}>
                                <h3 className={styles.sectionTitle}>所在地</h3>
                                <p className={styles.sectionDescription}>
                                    郵便番号と住所を分けると検索・請求書生成・名寄せが安定します。
                                </p>
                            </div>
                            <div className={styles.grid}>
                                <label className={styles.field}>
                                    <span>郵便番号</span>
                                    <input
                                        className={styles.input}
                                        value={form.postal_code}
                                        onChange={(event) => handleField("postal_code", event.target.value)}
                                        placeholder="150-0001"
                                        autoComplete="postal-code"
                                        inputMode="numeric"
                                    />
                                </label>

                                <label className={styles.field}>
                                    <span>都道府県</span>
                                    <select
                                        className={styles.input}
                                        value={form.prefecture}
                                        onChange={(event) => handleField("prefecture", event.target.value)}
                                        autoComplete="address-level1"
                                    >
                                        <option value="">選択してください</option>
                                        {PREFECTURES.map((prefecture) => (
                                            <option key={prefecture} value={prefecture}>
                                                {prefecture}
                                            </option>
                                        ))}
                                    </select>
                                </label>

                                <label className={styles.field}>
                                    <span>市区町村</span>
                                    <input
                                        className={styles.input}
                                        value={form.city}
                                        onChange={(event) => handleField("city", event.target.value)}
                                        placeholder="渋谷区"
                                        autoComplete="address-level2"
                                    />
                                </label>

                                <label className={styles.field}>
                                    <span>番地・町名</span>
                                    <input
                                        className={styles.input}
                                        value={form.address_line1}
                                        onChange={(event) => handleField("address_line1", event.target.value)}
                                        placeholder="神宮前1-2-3"
                                        autoComplete="address-line1"
                                    />
                                </label>

                                <label className={`${styles.field} ${styles.full}`}>
                                    <span>建物名・階数</span>
                                    <input
                                        className={styles.input}
                                        value={form.address_line2}
                                        onChange={(event) => handleField("address_line2", event.target.value)}
                                        placeholder="〇〇ビル 5F"
                                        autoComplete="address-line2"
                                    />
                                </label>
                            </div>
                        </section>

                        <section className={styles.section}>
                            <div className={styles.sectionHeader}>
                                <h3 className={styles.sectionTitle}>請求先</h3>
                                <p className={styles.sectionDescription}>基本住所と同じ場合はコピーして入力負荷を減らします。</p>
                            </div>
                            <label className={styles.checkboxRow}>
                                <input
                                    type="checkbox"
                                    checked={billingSameAsPrimary}
                                    onChange={(event) => setBillingSameAsPrimary(event.target.checked)}
                                />
                                <span>請求先住所は所在地と同じ</span>
                            </label>

                            {!billingSameAsPrimary && (
                                <div className={styles.grid}>
                                    <label className={styles.field}>
                                        <span>請求先郵便番号</span>
                                        <input
                                            className={styles.input}
                                            value={form.billing_postal_code}
                                            onChange={(event) => handleField("billing_postal_code", event.target.value)}
                                            placeholder="150-0001"
                                            autoComplete="billing postal-code"
                                            inputMode="numeric"
                                        />
                                    </label>

                                    <label className={styles.field}>
                                        <span>請求先都道府県</span>
                                        <select
                                            className={styles.input}
                                            value={form.billing_prefecture}
                                            onChange={(event) => handleField("billing_prefecture", event.target.value)}
                                            autoComplete="billing address-level1"
                                        >
                                            <option value="">選択してください</option>
                                            {PREFECTURES.map((prefecture) => (
                                                <option key={prefecture} value={prefecture}>
                                                    {prefecture}
                                                </option>
                                            ))}
                                        </select>
                                    </label>

                                    <label className={styles.field}>
                                        <span>請求先市区町村</span>
                                        <input
                                            className={styles.input}
                                            value={form.billing_city}
                                            onChange={(event) => handleField("billing_city", event.target.value)}
                                            placeholder="渋谷区"
                                            autoComplete="billing address-level2"
                                        />
                                    </label>

                                    <label className={styles.field}>
                                        <span>請求先番地・町名</span>
                                        <input
                                            className={styles.input}
                                            value={form.billing_address_line1}
                                            onChange={(event) => handleField("billing_address_line1", event.target.value)}
                                            placeholder="神宮前1-2-3"
                                            autoComplete="billing address-line1"
                                        />
                                    </label>

                                    <label className={`${styles.field} ${styles.full}`}>
                                        <span>請求先建物名・階数</span>
                                        <input
                                            className={styles.input}
                                            value={form.billing_address_line2}
                                            onChange={(event) => handleField("billing_address_line2", event.target.value)}
                                            placeholder="〇〇ビル 5F"
                                            autoComplete="billing address-line2"
                                        />
                                    </label>
                                </div>
                            )}
                        </section>

                        <section className={styles.section}>
                            <div className={styles.sectionHeader}>
                                <h3 className={styles.sectionTitle}>請求書デフォルト</h3>
                                <p className={styles.sectionDescription}>毎回の入力を減らす初期値です。</p>
                            </div>
                            <div className={styles.grid}>
                                <label className={styles.field}>
                                    <span>支払条件</span>
                                    <input
                                        className={styles.input}
                                        value={form.payment_terms}
                                        onChange={(event) => handleField("payment_terms", event.target.value)}
                                        placeholder="月末締め翌月末払い"
                                    />
                                </label>

                                <div className={styles.field} />

                                <label className={`${styles.field} ${styles.full}`}>
                                    <span>請求書のデフォルト備考</span>
                                    <textarea
                                        className={styles.textarea}
                                        value={form.invoice_notes_default}
                                        onChange={(event) => handleField("invoice_notes_default", event.target.value)}
                                        placeholder="お支払いは銀行振込でお願いいたします。"
                                        rows={4}
                                    />
                                </label>
                            </div>
                        </section>

                        <div className={styles.footer}>
                            {isEdit ? (
                                <div className={styles.dangerZone}>
                                    <button
                                        type="button"
                                        className={styles.dangerButton}
                                        onClick={openDeleteConfirm}
                                        disabled={deleting || saving}
                                    >
                                        <Trash2 size={16} />
                                        削除
                                    </button>
                                </div>
                            ) : (
                                <div className={styles.footerSpacer} />
                            )}

                            <div className={styles.actions}>
                                <button type="button" className={styles.secondaryButton} onClick={onClose}>
                                    キャンセル
                                </button>
                                <button type="submit" className={styles.primaryButton} disabled={saving || deleting || scanning}>
                                    {saving ? <Loader2 size={16} className={styles.spinner} /> : <Save size={16} />}
                                    {isEdit ? "更新" : "追加"}
                                </button>
                            </div>
                        </div>
                    </form>
                </motion.div>
            </motion.div>

            <AnimatePresence>
                {showDeleteConfirm && client && (
                    <motion.div
                        className={styles.confirmOverlay}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={closeDeleteConfirm}
                    >
                        <motion.div
                            className={styles.confirmDialog}
                            role="alertdialog"
                            aria-modal="true"
                            aria-labelledby="client-delete-title"
                            aria-describedby="client-delete-description"
                            initial={{ opacity: 0, y: 16, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 12, scale: 0.98 }}
                            onClick={(event) => event.stopPropagation()}
                        >
                            <h3 id="client-delete-title" className={styles.confirmTitle}>
                                <Trash2 size={18} />
                                取引先を削除
                            </h3>
                            <p id="client-delete-description" className={styles.confirmDescription}>
                                「{client.name}」を削除します。理由を記録してから削除してください。
                            </p>

                            <label className={styles.field}>
                                <span>削除理由</span>
                                <textarea
                                    className={styles.textarea}
                                    value={deleteReason}
                                    onChange={(event) => setDeleteReason(event.target.value)}
                                    placeholder="統合済み / 重複 / 誤登録"
                                    rows={3}
                                    autoFocus
                                />
                            </label>

                            {deleteError && <div className={styles.error}>{deleteError}</div>}

                            <div className={styles.confirmActions}>
                                <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={closeDeleteConfirm}
                                    disabled={deleting}
                                >
                                    キャンセル
                                </button>
                                <button
                                    type="button"
                                    className={styles.dangerButton}
                                    onClick={() => void handleDelete()}
                                    disabled={deleting}
                                >
                                    {deleting ? <Loader2 size={16} className={styles.spinner} /> : <Trash2 size={16} />}
                                    削除する
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
