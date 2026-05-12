import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    ArrowLeft,
    BadgeCheck,
    Building2,
    Check,
    ChevronRight,
    Copy,
    FileText,
    Loader2,
    Plus,
    ReceiptText,
    Search,
    Shield,
    ShieldOff,
    Trash2,
    UserPlus,
    Users,
} from "lucide-react";
import {
    bootstrapOrg,
    createOrgInvite,
    fetchClients,
    fetchInvoiceSettings,
    fetchMembers,
    fetchMyProfile,
    fetchProfileViewGrantsIncoming,
    listOrgInvites,
    removeOrgMember,
    restoreClient,
    revokeOrgInvite,
    revokeProfileViewGrant,
    updateMemberRole,
    updateMyProfile,
    type Client,
    type InvoiceSettings,
    type Member,
    type MyProfileRecord,
    type OrgInviteRecord,
    type OrgInviteRole,
    type ProfileViewGrant,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import { supabase } from "../lib/supabase";
import { useActiveOrgStore, type ActiveOrgOption } from "../stores/activeOrg";
import { InvoiceSettingsModal } from "../components/InvoiceSettingsModal";
import { ClientSettingsModal } from "../components/ClientSettingsModal";
import { ProfileViewConsentModal } from "../components/ProfileViewConsentModal";
import styles from "./Settings.module.css";

const statusMeta = {
    unregistered: {
        label: "未登録",
        helper: "通常請求",
    },
    applied: {
        label: "申請中",
        helper: "登録待ち",
    },
    registered: {
        label: "登録済み",
        helper: "発行可",
    },
} as const;

type SettingPanel = "profile" | "organization" | "members" | "invoice" | "clients";

type ProfileFormState = {
    full_name: string;
    username: string;
    phone: string;
    job_type: string;
    employment_kind: MyProfileRecord["employment_kind"];
    trade_name: string;
    invoice_registration_number: string;
    bank_name: string;
    branch_name: string;
    account_type: "" | NonNullable<MyProfileRecord["account_type"]>;
    account_number: string;
    account_holder_kana: string;
    postal_code: string;
    prefecture: string;
    city: string;
    address_line1: string;
    address_line2: string;
    emergency_contact_name: string;
    emergency_phone: string;
};

const emptyProfileForm: ProfileFormState = {
    full_name: "",
    username: "",
    phone: "",
    job_type: "",
    employment_kind: "employee",
    trade_name: "",
    invoice_registration_number: "",
    bank_name: "",
    branch_name: "",
    account_type: "",
    account_number: "",
    account_holder_kana: "",
    postal_code: "",
    prefecture: "",
    city: "",
    address_line1: "",
    address_line2: "",
    emergency_contact_name: "",
    emergency_phone: "",
};

function profileToFormState(profile: MyProfileRecord): ProfileFormState {
    return {
        full_name: profile.full_name ?? "",
        username: profile.username ?? "",
        phone: profile.phone ?? "",
        job_type: profile.job_type ?? "",
        employment_kind: profile.employment_kind,
        trade_name: profile.trade_name ?? "",
        invoice_registration_number: profile.invoice_registration_number ?? "",
        bank_name: profile.bank_name ?? "",
        branch_name: profile.branch_name ?? "",
        account_type: profile.account_type ?? "",
        account_number: profile.account_number ?? "",
        account_holder_kana: profile.account_holder_kana ?? "",
        postal_code: profile.postal_code ?? "",
        prefecture: profile.prefecture ?? "",
        city: profile.city ?? "",
        address_line1: profile.address_line1 ?? "",
        address_line2: profile.address_line2 ?? "",
        emergency_contact_name: profile.emergency_contact_name ?? "",
        emergency_phone: profile.emergency_phone ?? "",
    };
}

const EMPLOYMENT_KIND_LABEL: Record<MyProfileRecord["employment_kind"], string> = {
    employee: "社員",
    sole_proprietor: "一人親方",
    helper: "応援（日雇い）",
};

const ACCOUNT_TYPE_LABEL: Record<NonNullable<MyProfileRecord["account_type"]>, string> = {
    ordinary: "普通",
    checking: "当座",
};

function isProfileFormDirty(form: ProfileFormState, base: MyProfileRecord | null): boolean {
    if (!base) {
        return false;
    }
    const reference = profileToFormState(base);
    return (Object.keys(form) as Array<keyof ProfileFormState>).some((key) => form[key] !== reference[key]);
}

function formatProfileError(code: string): string {
    if (code === "PROFILE_USERNAME_TOO_SHORT") return "ユーザー名は3文字以上で入力してください。";
    if (code === "PROFILE_USERNAME_TAKEN") return "そのユーザー名は使われています。";
    if (code === "PROFILE_EMPLOYMENT_KIND_INVALID") return "雇用区分の指定が不正です。";
    if (code === "PROFILE_INVOICE_NUMBER_INVALID") return "インボイス番号は T で始まる14文字（T + 13桁）で入力してください。";
    if (code === "PROFILE_POSTAL_CODE_INVALID") return "郵便番号は 1234567 もしくは 123-4567 の形式で入力してください。";
    if (code === "PROFILE_ACCOUNT_TYPE_INVALID") return "口座種別の指定が不正です。";
    return code;
}

function buildInviteLink(inviteId: string) {
    // openExternalBrowser=1: LINE固有のクエリ。LINEトーク内で踏まれた時に
    // アプリ内WebViewではなくOS既定ブラウザ (Safari/Chrome) で開かせる。
    // これがないとGoogle OAuthが Error 403: disallowed_useragent でブロックされる。
    // 他のブラウザでは単なる無視されるクエリなので無害。
    if (typeof window === "undefined") {
        return `?invite=${inviteId}&openExternalBrowser=1`;
    }
    const url = new URL(window.location.origin);
    url.pathname = "/";
    url.searchParams.set("invite", inviteId);
    url.searchParams.set("openExternalBrowser", "1");
    return url.toString();
}

function formatInviteError(error: unknown) {
    const message = getErrorMessage(error);

    if (message === "ORG_INVITE_EMAIL_REQUIRED") {
        return "メールアドレスを入力してください。";
    }
    if (message === "ORG_INVITE_PENDING_DUPLICATE") {
        return "このメールには未受諾の招待がすでにあります。";
    }
    if (message === "ORG_INVITE_ROLE_INVALID") {
        return "権限の指定が不正です。";
    }
    if (message === "ORG_ROLE_REQUIRED") {
        return "招待の作成にはadmin権限が必要です。";
    }

    return message;
}

function formatMemberError(error: unknown) {
    const message = getErrorMessage(error);

    if (message === "ORG_MEMBER_NOT_FOUND") {
        return "対象メンバーが見つかりません。";
    }
    if (message === "ORG_MEMBER_LAST_ADMIN") {
        return "最後のadminは降格・削除できません。先に別の人をadminに変更してください。";
    }
    if (message === "ORG_MEMBER_REMOVE_SELF") {
        return "自分自身は削除できません。";
    }
    if (message === "ORG_MEMBER_ROLE_INVALID") {
        return "権限の指定が不正です。";
    }
    if (message === "ORG_ROLE_REQUIRED") {
        return "メンバーの変更にはadmin権限が必要です。";
    }

    return message;
}

function formatExpiresAt(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleDateString("ja-JP", {
        month: "numeric",
        day: "numeric",
    });
}

function formatOrgCreateError(error: unknown) {
    const message = getErrorMessage(error);

    if (message === "ORG_BOOTSTRAP_FORBIDDEN") {
        return "このアカウントでは組織を作成できません。";
    }

    if (message === "ORG_BOOTSTRAP_NAME_REQUIRED") {
        return "組織名を入力してください。";
    }

    if (message === "ORG_BOOTSTRAP_SLUG_CONFLICT") {
        return "そのslugは使われています。別のslugにしてください。";
    }

    return message;
}

export function Settings() {
    const [loading, setLoading] = useState(true);
    const [showInvoiceSettingsModal, setShowInvoiceSettingsModal] = useState(false);
    const [showClientModal, setShowClientModal] = useState(false);
    const [invoiceSettings, setInvoiceSettings] = useState<InvoiceSettings | null>(null);
    const [clients, setClients] = useState<Client[]>([]);
    const [deletedClients, setDeletedClients] = useState<Client[]>([]);
    const [editingClient, setEditingClient] = useState<Client | null>(null);
    const [pageError, setPageError] = useState<string | null>(null);
    const [restoringClientId, setRestoringClientId] = useState<string | null>(null);
    const [currentMember, setCurrentMember] = useState<Member | null>(null);
    const [members, setMembers] = useState<Member[]>([]);
    const [pendingInvites, setPendingInvites] = useState<OrgInviteRecord[]>([]);
    const [inviteEmail, setInviteEmail] = useState("");
    const [inviteRole, setInviteRole] = useState<OrgInviteRole>("member");
    const [inviteBusy, setInviteBusy] = useState(false);
    const [inviteError, setInviteError] = useState<string | null>(null);
    const [inviteMessage, setInviteMessage] = useState<string | null>(null);
    const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
    const [revokingInviteId, setRevokingInviteId] = useState<string | null>(null);
    const [memberBusyId, setMemberBusyId] = useState<string | null>(null);
    const [memberError, setMemberError] = useState<string | null>(null);
    const [memberMessage, setMemberMessage] = useState<string | null>(null);
    const [myProfile, setMyProfile] = useState<MyProfileRecord | null>(null);
    const [profileForm, setProfileForm] = useState<ProfileFormState>(emptyProfileForm);
    const [profileSaveBusy, setProfileSaveBusy] = useState(false);
    const [profileError, setProfileError] = useState<string | null>(null);
    const [profileMessage, setProfileMessage] = useState<string | null>(null);
    const [settingsQuery, setSettingsQuery] = useState("");
    const [selectedSetting, setSelectedSetting] = useState<SettingPanel | null>(null);
    const [extendedViewTarget, setExtendedViewTarget] = useState<Member | null>(null);
    const [incomingGrants, setIncomingGrants] = useState<ProfileViewGrant[]>([]);
    const [incomingGrantsLoading, setIncomingGrantsLoading] = useState(false);
    const [revokingGrantId, setRevokingGrantId] = useState<string | null>(null);
    const [orgName, setOrgName] = useState("");
    const [orgSlug, setOrgSlug] = useState("");
    const [orgCreateBusy, setOrgCreateBusy] = useState(false);
    const [orgCreateError, setOrgCreateError] = useState<string | null>(null);
    const [orgCreateMessage, setOrgCreateMessage] = useState<string | null>(null);
    const activeOrgId = useActiveOrgStore((state) => state.activeOrgId);
    const orgOptions = useActiveOrgStore((state) => state.options);
    const setOrgOptions = useActiveOrgStore((state) => state.setOptions);
    const setActiveOrgId = useActiveOrgStore((state) => state.setActiveOrgId);

    const loadPage = async () => {
        try {
            setLoading(true);
            setPageError(null);
            const {
                data: { session },
            } = await supabase.auth.getSession();
            const currentUserId = session?.user?.id || null;

            const [settingsData, clientsData, deletedClientsData, membersData] = await Promise.all([
                fetchInvoiceSettings(),
                fetchClients(),
                fetchClients({ status: "deleted" }),
                fetchMembers(),
            ]);

            setInvoiceSettings(settingsData);
            setClients(clientsData);
            setDeletedClients(deletedClientsData);
            setMembers(membersData);
            setCurrentMember(currentUserId ? membersData.find((member) => member.id === currentUserId) || null : null);

            if (!currentUserId) {
                return;
            }

            try {
                const inviteData = await listOrgInvites({ status: "pending" });
                setPendingInvites(inviteData.invites);
            } catch {
                setPendingInvites([]);
            }

            try {
                const profileData = await fetchMyProfile();
                setMyProfile(profileData.profile);
                setProfileForm(profileToFormState(profileData.profile));
            } catch {
                setMyProfile(null);
            }

            try {
                setIncomingGrantsLoading(true);
                const incoming = await fetchProfileViewGrantsIncoming();
                setIncomingGrants(incoming.grants);
            } catch {
                setIncomingGrants([]);
            } finally {
                setIncomingGrantsLoading(false);
            }
        } catch (err: unknown) {
            setPageError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    const refreshIncomingGrants = async () => {
        try {
            const incoming = await fetchProfileViewGrantsIncoming();
            setIncomingGrants(incoming.grants);
        } catch {
            // 失敗時は維持
        }
    };

    const handleRevokeIncomingGrant = async (grant: ProfileViewGrant) => {
        if (
            !window.confirm(
                `${grant.purpose ? `「${grant.purpose}」の` : ""}閲覧許可を取り消しますか？`,
            )
        ) {
            return;
        }
        setRevokingGrantId(grant.id);
        try {
            await revokeProfileViewGrant(grant.id);
            await refreshIncomingGrants();
        } catch (err) {
            setPageError(getErrorMessage(err));
        } finally {
            setRevokingGrantId(null);
        }
    };

    useEffect(() => {
        void loadPage();
    }, []);

    const refreshClients = async () => {
        const [nextClients, nextDeletedClients] = await Promise.all([
            fetchClients(),
            fetchClients({ status: "deleted" }),
        ]);
        setClients(nextClients);
        setDeletedClients(nextDeletedClients);
    };

    const closeClientModal = () => {
        setShowClientModal(false);
        setEditingClient(null);
    };

    const refreshInvites = async () => {
        try {
            const data = await listOrgInvites({ status: "pending" });
            setPendingInvites(data.invites);
        } catch {
            setPendingInvites([]);
        }
    };

    const handleCreateInvite = async () => {
        try {
            setInviteBusy(true);
            setInviteError(null);
            setInviteMessage(null);
            const result = await createOrgInvite({
                email: inviteEmail,
                role: inviteRole,
            });
            setInviteEmail("");
            setInviteRole("member");
            await refreshInvites();
            try {
                const link = buildInviteLink(result.invite.id);
                await navigator.clipboard.writeText(link);
                setCopiedInviteId(result.invite.id);
                setInviteMessage("招待リンクをコピーしました。LINE などで送ってください。");
            } catch {
                setInviteMessage("招待を作成しました。下のリストからリンクをコピーしてください。");
            }
        } catch (error: unknown) {
            setInviteError(formatInviteError(error));
        } finally {
            setInviteBusy(false);
        }
    };

    const handleCopyInvite = async (invite: OrgInviteRecord) => {
        try {
            await navigator.clipboard.writeText(buildInviteLink(invite.id));
            setCopiedInviteId(invite.id);
            setInviteMessage(`${invite.email_normalized} 宛のリンクをコピーしました。`);
            setInviteError(null);
        } catch (error: unknown) {
            setInviteError(getErrorMessage(error));
        }
    };

    const handleRevokeInvite = async (invite: OrgInviteRecord) => {
        if (typeof window !== "undefined") {
            const confirmed = window.confirm(`${invite.email_normalized} への招待を取り消しますか？`);
            if (!confirmed) {
                return;
            }
        }

        try {
            setRevokingInviteId(invite.id);
            setInviteError(null);
            await revokeOrgInvite(invite.id);
            await refreshInvites();
            setInviteMessage(`${invite.email_normalized} への招待を取り消しました。`);
        } catch (error: unknown) {
            setInviteError(formatInviteError(error));
        } finally {
            setRevokingInviteId(null);
        }
    };

    const handleChangeMemberRole = async (member: Member, nextRole: "admin" | "member") => {
        if (!member.role || member.role === nextRole) {
            return;
        }
        const memberLabel = member.full_name || member.username || "このメンバー";
        if (typeof window !== "undefined") {
            const roleLabel = nextRole === "admin" ? "admin（管理者）" : "member（通常）";
            const confirmed = window.confirm(`${memberLabel} の権限を ${roleLabel} に変更しますか？`);
            if (!confirmed) {
                return;
            }
        }

        try {
            setMemberBusyId(member.id);
            setMemberError(null);
            setMemberMessage(null);
            await updateMemberRole(member.id, nextRole);
            const nextMembers = await fetchMembers();
            setMembers(nextMembers);
            setMemberMessage(`${memberLabel} の権限を変更しました。`);
        } catch (error: unknown) {
            setMemberError(formatMemberError(error));
        } finally {
            setMemberBusyId(null);
        }
    };

    const handleRemoveMember = async (member: Member) => {
        const memberLabel = member.full_name || member.username || "このメンバー";
        if (typeof window !== "undefined") {
            const confirmed = window.confirm(
                `${memberLabel} を組織から外しますか？\n再度参加してもらうには招待を作り直す必要があります。`,
            );
            if (!confirmed) {
                return;
            }
        }

        try {
            setMemberBusyId(member.id);
            setMemberError(null);
            setMemberMessage(null);
            await removeOrgMember(member.id);
            const nextMembers = await fetchMembers();
            setMembers(nextMembers);
            setMemberMessage(`${memberLabel} を組織から外しました。`);
        } catch (error: unknown) {
            setMemberError(formatMemberError(error));
        } finally {
            setMemberBusyId(null);
        }
    };

    const setProfileField = <K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]) => {
        setProfileForm((prev) => ({ ...prev, [key]: value }));
        setProfileError(null);
        setProfileMessage(null);
    };

    const handleSaveProfile = async () => {
        try {
            setProfileSaveBusy(true);
            setProfileError(null);
            setProfileMessage(null);

            const text = (value: string) => value.trim() || null;
            const payload = {
                full_name: text(profileForm.full_name),
                username: text(profileForm.username),
                phone: text(profileForm.phone),
                job_type: text(profileForm.job_type),
                employment_kind: profileForm.employment_kind,
                trade_name: text(profileForm.trade_name),
                invoice_registration_number: text(profileForm.invoice_registration_number),
                bank_name: text(profileForm.bank_name),
                branch_name: text(profileForm.branch_name),
                account_type: profileForm.account_type === "" ? null : profileForm.account_type,
                account_number: text(profileForm.account_number),
                account_holder_kana: text(profileForm.account_holder_kana),
                postal_code: text(profileForm.postal_code),
                prefecture: text(profileForm.prefecture),
                city: text(profileForm.city),
                address_line1: text(profileForm.address_line1),
                address_line2: text(profileForm.address_line2),
                emergency_contact_name: text(profileForm.emergency_contact_name),
                emergency_phone: text(profileForm.emergency_phone),
            };

            const result = await updateMyProfile(payload);
            setMyProfile(result.profile);
            setProfileForm(profileToFormState(result.profile));
            setProfileMessage("プロフィールを保存しました。");

            const currentMembers = await fetchMembers();
            setMembers(currentMembers);
            const {
                data: { session },
            } = await supabase.auth.getSession();
            const uid = session?.user?.id || null;
            setCurrentMember(uid ? currentMembers.find((member) => member.id === uid) || null : null);
        } catch (error: unknown) {
            setProfileError(formatProfileError(getErrorMessage(error)));
        } finally {
            setProfileSaveBusy(false);
        }
    };

    const handleRestoreClient = async (clientId: string) => {
        try {
            setRestoringClientId(clientId);
            setPageError(null);
            await restoreClient(clientId);
            await refreshClients();
        } catch (err: unknown) {
            setPageError(getErrorMessage(err));
        } finally {
            setRestoringClientId(null);
        }
    };

    const currentInvoiceStatus = invoiceSettings
        ? statusMeta[invoiceSettings.invoice_issuer_status]
        : statusMeta.unregistered;
    const activeOrg = orgOptions.find((option) => option.org.id === activeOrgId) || null;
    const isCurrentUserAdmin = activeOrg?.membership.role === "admin";
    const displayName = currentMember?.full_name || currentMember?.username || "未設定";
    const profileSummaryDetail = myProfile?.job_type?.trim() || EMPLOYMENT_KIND_LABEL[myProfile?.employment_kind ?? "employee"];
    const settingsSearch = settingsQuery.trim().toLowerCase();
    const allSettingItems = [
        {
            id: "profile" as const,
            group: "個人",
            title: "プロフィール",
            summary: `${currentMember ? displayName : "未設定"} / ${profileSummaryDetail}`,
            icon: <Users size={20} />,
        },
        {
            id: "invoice" as const,
            group: "組織",
            title: "請求書",
            summary: `${currentInvoiceStatus.label} / ${invoiceSettings?.issuer_name || "未設定"}`,
            icon: <FileText size={20} />,
        },
        {
            id: "organization" as const,
            group: "組織",
            title: "組織",
            summary: activeOrg?.org.name || "表示中の組織",
            icon: <Building2 size={20} />,
        },
        {
            id: "members" as const,
            group: "組織",
            title: "メンバーと招待",
            summary: isCurrentUserAdmin
                ? `${members.length}人 / 招待中 ${pendingInvites.length}件`
                : `${members.length}人`,
            icon: <UserPlus size={20} />,
        },
        {
            id: "clients" as const,
            group: "組織",
            title: "取引先",
            summary: `${clients.length}件`,
            icon: <Building2 size={20} />,
        },
    ];
    const settingItems = allSettingItems.filter((item) => {
        if (!settingsSearch) {
            return true;
        }

        return [item.group, item.title, item.summary].some((value) => value.toLowerCase().includes(settingsSearch));
    });

    const selectedSettingMeta = allSettingItems.find((item) => item.id === selectedSetting);
    const orgCreateDisabled = orgCreateBusy || orgName.trim().length === 0;

    const handleCreateOrg = async () => {
        try {
            setOrgCreateBusy(true);
            setOrgCreateError(null);
            setOrgCreateMessage(null);

            const result = await bootstrapOrg({
                name: orgName,
                slug: orgSlug || null,
            });

            const nextOption: ActiveOrgOption = {
                org: {
                    id: result.active_org.id,
                    name: result.active_org.name,
                    slug: result.active_org.slug,
                    status: result.active_org.status,
                },
                membership: {
                    org_id: result.membership.org_id,
                    user_id: result.membership.user_id,
                    role: result.membership.role,
                    status: result.membership.status,
                },
            };
            const currentOptions = useActiveOrgStore.getState().options;
            setOrgOptions([
                ...currentOptions.filter((option) => option.org.id !== result.active_org.id),
                nextOption,
            ]);
            setActiveOrgId(result.active_org.id);
            setOrgName("");
            setOrgSlug("");
            setOrgCreateMessage(`${result.active_org.name} に切り替えました。`);
            await loadPage();
        } catch (error: unknown) {
            setOrgCreateError(formatOrgCreateError(error));
        } finally {
            setOrgCreateBusy(false);
        }
    };

    if (loading) {
        return (
            <div className={styles.loadingState}>
                <Loader2 size={24} className={styles.spinner} />
                <p>設定を読み込み中...</p>
            </div>
        );
    }

    if (pageError) {
        return (
            <div className={styles.errorState}>
                <h2>設定の読み込みに失敗しました</h2>
                <p>{pageError}</p>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <AnimatePresence mode="wait">
                {!selectedSetting ? (
                    <motion.div
                        key="settings-list"
                        className={styles.settingsView}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -12 }}
                        transition={{ duration: 0.18 }}
                    >
                        <section className={styles.searchHero}>
                            <h1 className={styles.visuallyHidden}>設定</h1>
                            <label className={styles.settingsSearch}>
                                <Search size={18} />
                                <input
                                    type="search"
                                    value={settingsQuery}
                                    onChange={(event) => setSettingsQuery(event.target.value)}
                                    placeholder="設定を検索"
                                />
                            </label>
                        </section>

                        {settingItems.length === 0 ? (
                            <div className={styles.emptyList}>該当なし</div>
                        ) : (
                            <section className={styles.sectionGrid}>
                                {settingItems.map((item) => (
                                    <motion.article
                                        key={item.id}
                                        className={styles.settingCard}
                                        initial={{ opacity: 0, y: 12 }}
                                        animate={{ opacity: 1, y: 0 }}
                                    >
                                        <button
                                            type="button"
                                            className={styles.settingRow}
                                            onClick={() => setSelectedSetting(item.id)}
                                        >
                                            <span className={styles.settingIcon}>{item.icon}</span>
                                            <span className={styles.settingCopy}>
                                                <span className={styles.cardEyebrow}>{item.group}</span>
                                                <strong>{item.title}</strong>
                                                <span>{item.summary}</span>
                                            </span>
                                            <ChevronRight size={18} className={styles.settingChevron} />
                                        </button>
                                    </motion.article>
                                ))}
                            </section>
                        )}
                    </motion.div>
                ) : (
                    <motion.section
                        key={`settings-detail-${selectedSetting}`}
                        className={styles.detailPage}
                        initial={{ opacity: 0, x: 18 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 18 }}
                        transition={{ duration: 0.18 }}
                    >
                        <header className={styles.detailTopBar}>
                            <button
                                type="button"
                                className={styles.backButton}
                                onClick={() => setSelectedSetting(null)}
                                aria-label="設定一覧へ戻る"
                            >
                                <ArrowLeft size={20} />
                                戻る
                            </button>
                            <h1 className={styles.detailTitle}>{selectedSettingMeta?.title}</h1>
                        </header>

                        {selectedSetting === "profile" && (
                            <>
                                <div className={styles.infoCard}>
                                    <div className={styles.infoCardHeader}>
                                        <div>
                                            <h3 className={styles.infoCardTitle}>基本情報</h3>
                                            <p className={styles.infoCardDescription}>
                                                チームで表示・連絡に使う情報です。
                                            </p>
                                        </div>
                                        <Users size={18} className={styles.infoCardIcon} />
                                    </div>

                                    <div className={styles.orgCreateForm}>
                                        <label className={styles.inputField}>
                                            <span>氏名（フルネーム）</span>
                                            <input
                                                value={profileForm.full_name}
                                                onChange={(event) => setProfileField("full_name", event.target.value)}
                                                placeholder="例: 山田 太郎"
                                                maxLength={80}
                                            />
                                        </label>
                                        <label className={styles.inputField}>
                                            <span>ユーザー名（3文字以上）</span>
                                            <input
                                                value={profileForm.username}
                                                onChange={(event) => setProfileField("username", event.target.value)}
                                                placeholder="例: yamada"
                                                maxLength={40}
                                            />
                                        </label>
                                        <label className={styles.inputField}>
                                            <span>電話</span>
                                            <input
                                                type="tel"
                                                value={profileForm.phone}
                                                onChange={(event) => setProfileField("phone", event.target.value)}
                                                placeholder="例: 090-1234-5678"
                                                maxLength={32}
                                            />
                                        </label>
                                        <label className={styles.inputField}>
                                            <span>職種</span>
                                            <input
                                                value={profileForm.job_type}
                                                onChange={(event) => setProfileField("job_type", event.target.value)}
                                                placeholder="例: クロス / 大工 / 塗装"
                                                maxLength={40}
                                            />
                                        </label>
                                        <label className={styles.inputField}>
                                            <span>雇用区分</span>
                                            <select
                                                value={profileForm.employment_kind}
                                                onChange={(event) =>
                                                    setProfileField(
                                                        "employment_kind",
                                                        event.target.value as ProfileFormState["employment_kind"],
                                                    )
                                                }
                                            >
                                                {(Object.keys(EMPLOYMENT_KIND_LABEL) as Array<ProfileFormState["employment_kind"]>)
                                                    .map((value) => (
                                                        <option key={value} value={value}>
                                                            {EMPLOYMENT_KIND_LABEL[value]}
                                                        </option>
                                                    ))}
                                            </select>
                                        </label>
                                    </div>
                                </div>

                                <div className={styles.infoCard}>
                                    <div className={styles.infoCardHeader}>
                                        <div>
                                            <h3 className={styles.infoCardTitle}>住所</h3>
                                            <p className={styles.infoCardDescription}>
                                                請求書・支払書類の宛先に使います。
                                            </p>
                                        </div>
                                        <Building2 size={18} className={styles.infoCardIcon} />
                                    </div>

                                    <div className={styles.orgCreateForm}>
                                        <label className={styles.inputField}>
                                            <span>郵便番号</span>
                                            <input
                                                value={profileForm.postal_code}
                                                onChange={(event) => setProfileField("postal_code", event.target.value)}
                                                placeholder="例: 123-4567"
                                                maxLength={8}
                                            />
                                        </label>
                                        <label className={styles.inputField}>
                                            <span>都道府県</span>
                                            <input
                                                value={profileForm.prefecture}
                                                onChange={(event) => setProfileField("prefecture", event.target.value)}
                                                placeholder="例: 東京都"
                                                maxLength={16}
                                            />
                                        </label>
                                        <label className={styles.inputField}>
                                            <span>市区町村</span>
                                            <input
                                                value={profileForm.city}
                                                onChange={(event) => setProfileField("city", event.target.value)}
                                                placeholder="例: 渋谷区"
                                                maxLength={64}
                                            />
                                        </label>
                                        <label className={styles.inputField}>
                                            <span>町名・番地</span>
                                            <input
                                                value={profileForm.address_line1}
                                                onChange={(event) => setProfileField("address_line1", event.target.value)}
                                                placeholder="例: 道玄坂1-2-3"
                                                maxLength={128}
                                            />
                                        </label>
                                        <label className={styles.inputField}>
                                            <span>建物名・部屋番号（任意）</span>
                                            <input
                                                value={profileForm.address_line2}
                                                onChange={(event) => setProfileField("address_line2", event.target.value)}
                                                placeholder="例: 渋谷ビル 4F"
                                                maxLength={128}
                                            />
                                        </label>
                                    </div>
                                </div>

                                <div className={styles.infoCard}>
                                    <div className={styles.infoCardHeader}>
                                        <div>
                                            <h3 className={styles.infoCardTitle}>振込先・税情報</h3>
                                            <p className={styles.infoCardDescription}>
                                                {profileForm.employment_kind === "sole_proprietor"
                                                    ? "一人親方は振込先とインボイス番号の登録が必要です。"
                                                    : profileForm.employment_kind === "helper"
                                                      ? "応援は振込先の登録があると支払いがスムーズです。"
                                                      : "給与振込先の登録に使います。"}
                                            </p>
                                        </div>
                                        <ReceiptText size={18} className={styles.infoCardIcon} />
                                    </div>

                                    {profileForm.employment_kind === "sole_proprietor" &&
                                        !profileForm.invoice_registration_number.trim() && (
                                            <p className={styles.formError}>
                                                インボイス番号が未登録です。仕入税額控除のため早めに登録してください。
                                            </p>
                                        )}

                                    <div className={styles.orgCreateForm}>
                                        <label className={styles.inputField}>
                                            <span>屋号（任意）</span>
                                            <input
                                                value={profileForm.trade_name}
                                                onChange={(event) => setProfileField("trade_name", event.target.value)}
                                                placeholder="例: 山田内装"
                                                maxLength={80}
                                            />
                                        </label>
                                        <label className={styles.inputField}>
                                            <span>インボイス登録番号</span>
                                            <input
                                                value={profileForm.invoice_registration_number}
                                                onChange={(event) =>
                                                    setProfileField(
                                                        "invoice_registration_number",
                                                        event.target.value.toUpperCase(),
                                                    )
                                                }
                                                placeholder="T + 13桁（例: T1234567890123）"
                                                maxLength={14}
                                            />
                                        </label>
                                        <label className={styles.inputField}>
                                            <span>銀行名</span>
                                            <input
                                                value={profileForm.bank_name}
                                                onChange={(event) => setProfileField("bank_name", event.target.value)}
                                                placeholder="例: 三菱UFJ銀行"
                                                maxLength={40}
                                            />
                                        </label>
                                        <label className={styles.inputField}>
                                            <span>支店名</span>
                                            <input
                                                value={profileForm.branch_name}
                                                onChange={(event) => setProfileField("branch_name", event.target.value)}
                                                placeholder="例: 渋谷支店"
                                                maxLength={40}
                                            />
                                        </label>
                                        <label className={styles.inputField}>
                                            <span>口座種別</span>
                                            <select
                                                value={profileForm.account_type}
                                                onChange={(event) =>
                                                    setProfileField(
                                                        "account_type",
                                                        event.target.value as ProfileFormState["account_type"],
                                                    )
                                                }
                                            >
                                                <option value="">未選択</option>
                                                {(Object.keys(ACCOUNT_TYPE_LABEL) as Array<NonNullable<MyProfileRecord["account_type"]>>)
                                                    .map((value) => (
                                                        <option key={value} value={value}>
                                                            {ACCOUNT_TYPE_LABEL[value]}
                                                        </option>
                                                    ))}
                                            </select>
                                        </label>
                                        <label className={styles.inputField}>
                                            <span>口座番号</span>
                                            <input
                                                inputMode="numeric"
                                                value={profileForm.account_number}
                                                onChange={(event) => setProfileField("account_number", event.target.value)}
                                                placeholder="例: 1234567"
                                                maxLength={16}
                                            />
                                        </label>
                                        <label className={styles.inputField}>
                                            <span>口座名義（カナ）</span>
                                            <input
                                                value={profileForm.account_holder_kana}
                                                onChange={(event) =>
                                                    setProfileField("account_holder_kana", event.target.value)
                                                }
                                                placeholder="例: ヤマダ タロウ"
                                                maxLength={80}
                                            />
                                        </label>
                                    </div>
                                </div>

                                <div className={styles.infoCard}>
                                    <div className={styles.infoCardHeader}>
                                        <div>
                                            <h3 className={styles.infoCardTitle}>緊急連絡先</h3>
                                            <p className={styles.infoCardDescription}>
                                                現場での事故・体調不良などで本人に連絡できないときに使います。
                                            </p>
                                        </div>
                                        <Users size={18} className={styles.infoCardIcon} />
                                    </div>

                                    <div className={styles.orgCreateForm}>
                                        <label className={styles.inputField}>
                                            <span>連絡先の氏名</span>
                                            <input
                                                value={profileForm.emergency_contact_name}
                                                onChange={(event) =>
                                                    setProfileField("emergency_contact_name", event.target.value)
                                                }
                                                placeholder="例: 山田 花子（妻）"
                                                maxLength={80}
                                            />
                                        </label>
                                        <label className={styles.inputField}>
                                            <span>電話</span>
                                            <input
                                                type="tel"
                                                value={profileForm.emergency_phone}
                                                onChange={(event) =>
                                                    setProfileField("emergency_phone", event.target.value)
                                                }
                                                placeholder="例: 090-1234-5678"
                                                maxLength={32}
                                            />
                                        </label>
                                    </div>
                                </div>

                                <div className={styles.infoCard}>
                                    {profileError && <p className={styles.formError}>{profileError}</p>}
                                    {profileMessage && <p className={styles.successMessage}>{profileMessage}</p>}

                                    <button
                                        type="button"
                                        className={styles.primaryButton}
                                        onClick={() => void handleSaveProfile()}
                                        disabled={profileSaveBusy || !isProfileFormDirty(profileForm, myProfile)}
                                        aria-busy={profileSaveBusy}
                                    >
                                        {profileSaveBusy ? (
                                            <Loader2 size={16} className={styles.spinner} />
                                        ) : (
                                            <Check size={16} />
                                        )}
                                        プロフィールを保存
                                    </button>
                                </div>
                            </>
                        )}

                        {selectedSetting === "invoice" && (
                            <>
                                <div className={styles.detailHeader}>
                                    <div className={styles.invoiceStatus}>
                                        <span className={styles.statusChip}>{currentInvoiceStatus.label}</span>
                                        <p>{currentInvoiceStatus.helper}</p>
                                    </div>
                                    <button className={styles.primaryButton} onClick={() => setShowInvoiceSettingsModal(true)}>
                                        <FileText size={16} />
                                        編集
                                    </button>
                                </div>

                                <div className={styles.invoicePreview}>
                                    <div className={styles.previewRow}>
                                        <Building2 size={16} />
                                        <span>{invoiceSettings?.issuer_name || "発行者名未設定"}</span>
                                    </div>
                                    <div className={styles.previewRow}>
                                        <ReceiptText size={16} />
                                        <span>
                                            {invoiceSettings?.qualified_invoice_registration_number || "登録番号未設定"}
                                        </span>
                                    </div>
                                    <div className={styles.previewMeta}>
                                        <span>{invoiceSettings?.issuer_address || "住所未設定"}</span>
                                        <span>{invoiceSettings?.bank_account_text || "振込先未設定"}</span>
                                    </div>
                                </div>
                            </>
                        )}

                        {selectedSetting === "organization" && (
                            <>
                                <div className={styles.orgCurrentPanel}>
                                    <div>
                                        <span className={styles.infoLabel}>表示中</span>
                                        <strong>{activeOrg?.org.name || "組織未選択"}</strong>
                                        <p>{activeOrg?.membership.role === "admin" ? "admin" : "member"}</p>
                                    </div>
                                    <span className={styles.statusChip}>
                                        {orgOptions.length}組織
                                    </span>
                                </div>

                                <div className={styles.infoCard}>
                                    <div className={styles.infoCardHeader}>
                                        <div>
                                            <h3 className={styles.infoCardTitle}>新しい組織</h3>
                                            <p className={styles.infoCardDescription}>
                                                作成後、このアカウントがadminとして所属します。
                                            </p>
                                        </div>
                                        <Building2 size={18} className={styles.infoCardIcon} />
                                    </div>

                                    <div className={styles.orgCreateForm}>
                                        <label className={styles.inputField}>
                                            <span>組織名</span>
                                            <input
                                                value={orgName}
                                                onChange={(event) => {
                                                    setOrgName(event.target.value);
                                                    setOrgCreateError(null);
                                                }}
                                                placeholder="例: 新会社"
                                            />
                                        </label>
                                        <label className={styles.inputField}>
                                            <span>slug（任意）</span>
                                            <input
                                                value={orgSlug}
                                                onChange={(event) => {
                                                    setOrgSlug(event.target.value);
                                                    setOrgCreateError(null);
                                                }}
                                                placeholder="例: new-company"
                                            />
                                        </label>

                                        {orgCreateError && <p className={styles.formError}>{orgCreateError}</p>}
                                        {orgCreateMessage && <p className={styles.successMessage}>{orgCreateMessage}</p>}

                                        <button
                                            type="button"
                                            className={styles.primaryButton}
                                            onClick={() => void handleCreateOrg()}
                                            disabled={orgCreateDisabled}
                                            aria-busy={orgCreateBusy}
                                        >
                                            {orgCreateBusy ? <Loader2 size={16} className={styles.spinner} /> : <Plus size={16} />}
                                            作成
                                        </button>
                                    </div>
                                </div>

                                <div className={styles.infoCard}>
                                    <div className={styles.infoCardHeader}>
                                        <div>
                                            <h3 className={styles.infoCardTitle}>参加中</h3>
                                        </div>
                                    </div>
                                    <div className={styles.orgList}>
                                        {orgOptions.map((option) => (
                                            <button
                                                key={option.org.id}
                                                type="button"
                                                className={`${styles.orgListItem} ${
                                                    option.org.id === activeOrgId ? styles.orgListItemActive : ""
                                                }`}
                                                onClick={() => {
                                                    setActiveOrgId(option.org.id);
                                                    setOrgCreateMessage(`${option.org.name} に切り替えました。`);
                                                    void loadPage();
                                                }}
                                            >
                                                <span>
                                                    <strong>{option.org.name}</strong>
                                                    <small>{option.membership.role}</small>
                                                </span>
                                                {option.org.id === activeOrgId && <BadgeCheck size={18} />}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}

                        {selectedSetting === "members" && (
                            <>
                                <div className={styles.detailHeader}>
                                    <div className={styles.clientListSummary}>
                                        <Users size={16} />
                                        <span>{members.length}人 / 招待中 {pendingInvites.length}件</span>
                                    </div>
                                </div>

                                {isCurrentUserAdmin && (
                                    <div className={styles.infoCard}>
                                        <div className={styles.infoCardHeader}>
                                            <div>
                                                <h3 className={styles.infoCardTitle}>招待を作る</h3>
                                                <p className={styles.infoCardDescription}>
                                                    招待先のメールと役割を指定すると、リンクが発行されます。
                                                    LINE などで本人に送ってください。
                                                </p>
                                            </div>
                                            <UserPlus size={18} className={styles.infoCardIcon} />
                                        </div>

                                        <div className={styles.orgCreateForm}>
                                            <label className={styles.inputField}>
                                                <span>メール</span>
                                                <input
                                                    type="email"
                                                    autoComplete="off"
                                                    value={inviteEmail}
                                                    onChange={(event) => {
                                                        setInviteEmail(event.target.value);
                                                        setInviteError(null);
                                                    }}
                                                    placeholder="例: foo@example.com"
                                                />
                                            </label>
                                            <label className={styles.inputField}>
                                                <span>役割</span>
                                                <select
                                                    value={inviteRole}
                                                    onChange={(event) => {
                                                        setInviteRole(event.target.value as OrgInviteRole);
                                                        setInviteError(null);
                                                    }}
                                                >
                                                    <option value="member">member（通常）</option>
                                                    <option value="admin">admin（管理者）</option>
                                                </select>
                                            </label>

                                            {inviteError && <p className={styles.formError}>{inviteError}</p>}
                                            {inviteMessage && <p className={styles.successMessage}>{inviteMessage}</p>}

                                            <button
                                                type="button"
                                                className={styles.primaryButton}
                                                onClick={() => void handleCreateInvite()}
                                                disabled={inviteBusy || inviteEmail.trim().length === 0}
                                                aria-busy={inviteBusy}
                                            >
                                                {inviteBusy ? (
                                                    <Loader2 size={16} className={styles.spinner} />
                                                ) : (
                                                    <Plus size={16} />
                                                )}
                                                招待を作る
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {isCurrentUserAdmin && (
                                    <div className={styles.infoCard}>
                                        <div className={styles.infoCardHeader}>
                                            <div>
                                                <h3 className={styles.infoCardTitle}>未受諾の招待</h3>
                                                <p className={styles.infoCardDescription}>
                                                    リンクをコピーして本人に再送できます。期限切れ前に受諾してもらってください。
                                                </p>
                                            </div>
                                        </div>

                                        {pendingInvites.length === 0 ? (
                                            <div className={styles.emptyList}>招待中の人はいません</div>
                                        ) : (
                                            <div className={styles.orgList}>
                                                {pendingInvites.map((invite) => (
                                                    <div key={invite.id} className={styles.orgListItem}>
                                                        <span>
                                                            <strong>{invite.email_normalized}</strong>
                                                            <small>
                                                                {invite.role} ・ 期限 {formatExpiresAt(invite.expires_at)}
                                                            </small>
                                                        </span>
                                                        <span style={{ display: "flex", gap: 8 }}>
                                                            <button
                                                                type="button"
                                                                className={styles.secondaryButton}
                                                                onClick={() => void handleCopyInvite(invite)}
                                                            >
                                                                {copiedInviteId === invite.id ? (
                                                                    <Check size={16} />
                                                                ) : (
                                                                    <Copy size={16} />
                                                                )}
                                                                {copiedInviteId === invite.id ? "コピー済" : "リンク"}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className={styles.restoreButton}
                                                                onClick={() => void handleRevokeInvite(invite)}
                                                                disabled={revokingInviteId === invite.id}
                                                                aria-label="招待を取り消す"
                                                            >
                                                                {revokingInviteId === invite.id ? (
                                                                    <Loader2 size={14} className={styles.spinner} />
                                                                ) : (
                                                                    <Trash2 size={14} />
                                                                )}
                                                            </button>
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className={styles.infoCard}>
                                    <div className={styles.infoCardHeader}>
                                        <div>
                                            <h3 className={styles.infoCardTitle}>メンバー</h3>
                                            {isCurrentUserAdmin && (
                                                <p className={styles.infoCardDescription}>
                                                    権限変更や削除ができます。最後のadminは降格・削除できません。
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    {memberError && <p className={styles.formError}>{memberError}</p>}
                                    {memberMessage && <p className={styles.successMessage}>{memberMessage}</p>}

                                    {members.length === 0 ? (
                                        <div className={styles.emptyList}>メンバーがいません</div>
                                    ) : (
                                        <div className={styles.orgList}>
                                            {members.map((member) => {
                                                const isSelf = currentMember?.id === member.id;
                                                const canManage = isCurrentUserAdmin && !isSelf;
                                                const busy = memberBusyId === member.id;
                                                const currentRole: "admin" | "member" = member.role === "admin" ? "admin" : "member";
                                                return (
                                                    <div key={member.id} className={styles.orgListItem}>
                                                        <span>
                                                            <strong>
                                                                {member.full_name || member.username || "未設定"}
                                                            </strong>
                                                            <small>
                                                                {currentRole === "admin" ? "admin（管理者）" : "member（通常）"}
                                                                {isSelf && " ・ あなた"}
                                                            </small>
                                                        </span>
                                                        {canManage ? (
                                                            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                                                <button
                                                                    type="button"
                                                                    className={styles.secondaryButton}
                                                                    onClick={() => setExtendedViewTarget(member)}
                                                                    aria-label="拡張情報を見る (本人承認が必要)"
                                                                    title="拡張情報を見る (本人承認が必要)"
                                                                >
                                                                    <Shield size={14} />
                                                                </button>
                                                                <select
                                                                    value={currentRole}
                                                                    onChange={(event) =>
                                                                        void handleChangeMemberRole(
                                                                            member,
                                                                            event.target.value as "admin" | "member",
                                                                        )
                                                                    }
                                                                    disabled={busy}
                                                                    aria-label="権限を変更"
                                                                >
                                                                    <option value="member">member</option>
                                                                    <option value="admin">admin</option>
                                                                </select>
                                                                <button
                                                                    type="button"
                                                                    className={styles.restoreButton}
                                                                    onClick={() => void handleRemoveMember(member)}
                                                                    disabled={busy}
                                                                    aria-label="メンバーを削除"
                                                                >
                                                                    {busy ? (
                                                                        <Loader2 size={14} className={styles.spinner} />
                                                                    ) : (
                                                                        <Trash2 size={14} />
                                                                    )}
                                                                </button>
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                <div className={styles.infoCard}>
                                    <div className={styles.infoCardHeader}>
                                        <div>
                                            <h3 className={styles.infoCardTitle}>あなたを見られる人</h3>
                                            <p className={styles.infoCardDescription}>
                                                振込先や住所など、あなたの拡張情報を一時的に見る権限を持つ人の一覧です。いつでも取り消せます。
                                            </p>
                                        </div>
                                    </div>

                                    {incomingGrantsLoading ? (
                                        <div className={styles.emptyList}>
                                            <Loader2 size={14} className={styles.spinner} /> 確認中...
                                        </div>
                                    ) : incomingGrants.length === 0 ? (
                                        <div className={styles.emptyList}>
                                            まだあなたの拡張情報を見られる人はいません
                                        </div>
                                    ) : (
                                        <div className={styles.orgList}>
                                            {incomingGrants.map((grant) => {
                                                const now = Date.now();
                                                const expired = new Date(grant.expires_at).getTime() <= now;
                                                const revoked = grant.revoked_at !== null;
                                                const active = !expired && !revoked;
                                                const adminName =
                                                    members.find((m) => m.id === grant.requesting_admin_id)?.full_name ||
                                                    members.find((m) => m.id === grant.requesting_admin_id)?.username ||
                                                    "不明な管理者";
                                                const stateLabel = revoked
                                                    ? "取り消し済み"
                                                    : expired
                                                    ? "期限切れ"
                                                    : "閲覧中";
                                                return (
                                                    <div key={grant.id} className={styles.orgListItem}>
                                                        <span>
                                                            <strong>{adminName}</strong>
                                                            <small>
                                                                {stateLabel} ・ 目的: {grant.purpose}
                                                            </small>
                                                        </span>
                                                        {active && (
                                                            <button
                                                                type="button"
                                                                className={styles.restoreButton}
                                                                onClick={() => void handleRevokeIncomingGrant(grant)}
                                                                disabled={revokingGrantId === grant.id}
                                                                aria-label="閲覧許可を取り消す"
                                                                title="閲覧許可を取り消す"
                                                            >
                                                                {revokingGrantId === grant.id ? (
                                                                    <Loader2 size={14} className={styles.spinner} />
                                                                ) : (
                                                                    <ShieldOff size={14} />
                                                                )}
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}

                        {selectedSetting === "clients" && (
                            <>
                                <div className={styles.detailHeader}>
                                    <div className={styles.clientListSummary}>
                                        <Users size={16} />
                                        <span>{clients.length}件</span>
                                    </div>
                                    <button
                                        className={styles.secondaryButton}
                                        onClick={() => {
                                            setEditingClient(null);
                                            setShowClientModal(true);
                                        }}
                                    >
                                        <Plus size={16} />
                                        追加
                                    </button>
                                </div>
                                <div className={styles.clientList}>
                                    {clients.length === 0 ? (
                                        <div className={styles.emptyList}>取引先なし</div>
                                    ) : (
                                        <div className={styles.clientGrid}>
                                            {clients.map((client) => (
                                                <button
                                                    key={client.id}
                                                    className={styles.clientListItem}
                                                    onClick={() => {
                                                        setEditingClient(client);
                                                        setShowClientModal(true);
                                                    }}
                                                >
                                                    <strong>{client.name}</strong>
                                                    <span>{client.billing_name || "請求書の宛名未設定"}</span>
                                                    <span>{client.billing_address || client.address || "住所未設定"}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {deletedClients.length > 0 && (
                                        <div className={styles.deletedSection}>
                                            <div className={styles.deletedHeader}>
                                                <span className={styles.deletedTitle}>削除済み</span>
                                                <span>{deletedClients.length}件</span>
                                            </div>

                                            <div className={styles.deletedList}>
                                                {deletedClients.map((client) => (
                                                    <div key={client.id} className={styles.deletedItem}>
                                                        <div className={styles.deletedCopy}>
                                                            <strong>{client.name}</strong>
                                                            <span>{client.deletion_reason || "削除理由なし"}</span>
                                                        </div>
                                                        <button
                                                            className={styles.restoreButton}
                                                            onClick={() => void handleRestoreClient(client.id)}
                                                            disabled={restoringClientId === client.id}
                                                        >
                                                            {restoringClientId === client.id ? "復元中..." : "復元"}
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </motion.section>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showInvoiceSettingsModal && (
                    <InvoiceSettingsModal
                        onClose={() => setShowInvoiceSettingsModal(false)}
                        onSaved={(settings) => {
                            setInvoiceSettings(settings);
                            setShowInvoiceSettingsModal(false);
                        }}
                    />
                )}

                {showClientModal && (
                    <ClientSettingsModal
                        client={editingClient}
                        onClose={closeClientModal}
                        onSaved={async () => {
                            await refreshClients();
                            closeClientModal();
                        }}
                        onDeleted={async () => {
                            await refreshClients();
                            closeClientModal();
                        }}
                    />
                )}

                {extendedViewTarget && (
                    <ProfileViewConsentModal
                        targetUserId={extendedViewTarget.id}
                        targetDisplayName={
                            extendedViewTarget.full_name ||
                            extendedViewTarget.username ||
                            "未設定"
                        }
                        onClose={() => setExtendedViewTarget(null)}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
